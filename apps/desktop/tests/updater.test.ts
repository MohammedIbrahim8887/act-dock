import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AUTO_INSTALL_DELAY,
  DesktopUpdater,
  macInstallScript,
  type UpdaterDeps,
} from "../src/bun/updater";
import {
  detectInstall,
  isNewerVersion,
  parseManifest,
  updateFeed,
} from "../src/shared/updates";

const flush = () => new Promise((r) => setTimeout(r, 20));
const release = "https://github.com/MohammedIbrahim8887/act-dock/releases/download/";

test("versions compare numerically and manifests cannot point downloads elsewhere", () => {
  expect(isNewerVersion("0.2.10", "0.2.9")).toBe(true);
  expect(isNewerVersion("0.2.4", "0.2.4")).toBe(false);
  expect(isNewerVersion("0.1.9", "0.2.0")).toBe(false);
  expect(isNewerVersion("1.0.0-beta", "0.2.0")).toBe(false);
  const sha = "a".repeat(64);
  const manifest = parseManifest({
    version: "0.3.0",
    assets: [
      { kind: "macos-arm64", url: `${release}v0.3.0/a.dmg`, sha256: sha, size: 10 },
      { kind: "windows-x64", url: "https://evil.example/a.exe", sha256: sha, size: 10 },
      { kind: "linux-x64-deb", url: `${release}v0.2.0/old.deb`, sha256: sha, size: 10 },
      { kind: "linux-x64-rpm", url: `${release}v0.3.0/a.rpm`, sha256: "nope", size: 10 },
    ],
  });
  expect(manifest.assets.map((a) => a.kind)).toEqual(["macos-arm64"]);
  expect(() => parseManifest({ version: "latest", assets: [] })).toThrow();
  // The test feed override only accepts loopback addresses.
  expect(updateFeed({ ACT_DOCK_UPDATE_FEED: "http://127.0.0.1:8765/manifest.json" }).assets).toBe("http://127.0.0.1:8765/");
  expect(updateFeed({ ACT_DOCK_UPDATE_FEED: "http://evil.example/manifest.json" }).manifest).toContain("github.com");
  expect(updateFeed({ ACT_DOCK_UPDATE_FEED: "https://127.0.0.1.evil.example/manifest.json" }).manifest).toContain("github.com");
});

test("install kinds follow where the app runs from", () => {
  const mac = "/Applications/Act Dock.app/Contents/MacOS/bun";
  expect(detectInstall("darwin", "arm64", mac, {}, "stable")).toEqual({
    kind: "macos-app",
    root: "/Applications/Act Dock.app",
  });
  expect(detectInstall("darwin", "arm64", "/Volumes/Act Dock/Act Dock.app/Contents/MacOS/bun", {}, "stable").kind).toBe("unsupported");
  expect(detectInstall("darwin", "arm64", mac, {}, "dev").kind).toBe("development");
  expect(detectInstall("win32", "x64", "C:\\Users\\a\\AppData\\Local\\Programs\\Act Dock\\bin\\bun.exe", {}, "stable")).toEqual({
    kind: "windows-installer",
    root: "C:\\Users\\a\\AppData\\Local\\Programs\\Act Dock",
  });
  expect(detectInstall("linux", "x64", "/tmp/.mount_x/usr/lib/act-dock/bin/bun", { APPIMAGE: "/home/a/Act.AppImage" }, "stable").kind).toBe("linux-appimage");
  expect(detectInstall("linux", "x64", "/opt/act-dock/bin/bun", {}, "stable").kind).toBe("linux-deb");
});

function harness(payload: Uint8Array, opts: { busy?: string | null; sha?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ad-updater-"));
  const appimage = join(dir, "Act Dock.AppImage");
  writeFileSync(appimage, "old");
  const sha = opts.sha ?? createHash("sha256").update(payload).digest("hex");
  const timers: { fn: () => void; ms: number }[] = [];
  const spawned: string[][] = [];
  const notices: string[] = [];
  let quits = 0;
  let busy = opts.busy ?? null;
  let now = 1_000_000;
  const deps: UpdaterDeps = {
    version: "0.2.4",
    channel: "stable",
    platform: "linux",
    arch: "x64",
    execPath: "/tmp/.mount/usr/lib/act-dock/bin/bun",
    env: { APPIMAGE: appimage },
    dataDir: join(dir, "data"),
    busy: async () => busy,
    notify: (title) => notices.push(title),
    quit: () => (quits++, true),
    exec: () => ({ code: 1, stdout: "" }),
    spawnDetached: (cmd) => spawned.push(cmd),
    now: () => now,
    setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimer: () => {},
    fetch: (async (url: string) => {
      if (String(url).includes("manifest.json"))
        return Response.json({
          version: "0.2.5",
          publishedAt: "2026-10-28T00:00:00Z",
          assets: [
            {
              kind: "linux-x64-appimage",
              name: "linux-x64-ActDock.AppImage",
              url: `${release}v0.2.5/linux-x64-ActDock.AppImage`,
              sha256: sha,
              size: payload.byteLength,
            },
          ],
        });
      return new Response(new Blob([payload as Uint8Array<ArrayBuffer>]));
    }) as unknown as typeof fetch,
  };
  return {
    dir,
    appimage,
    timers,
    spawned,
    notices,
    deps,
    get quits() {
      return quits;
    },
    setBusy: (b: string | null) => (busy = b),
    advance: (ms: number) => (now += ms),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("an update downloads, verifies, counts down, waits for pipelines, then installs and quits", async () => {
  const h = harness(new TextEncoder().encode("new build"), { busy: "Waiting for 1 pipeline to finish" });
  try {
    const updater = new DesktopUpdater(h.deps);
    expect(updater.state.installKind).toBe("linux-appimage");
    await updater.check();
    expect(updater.state.status).toBe("ready");
    expect(updater.state.version).toBe("0.2.5");
    expect(h.notices).toEqual(["Act Dock 0.2.5 is ready"]);
    expect(updater.state.installAt).toBe(1_000_000 + AUTO_INSTALL_DELAY);
    // The countdown fires while a pipeline is running: nothing quits.
    h.timers.at(-1)!.fn();
    await flush();
    expect(h.quits).toBe(0);
    expect(updater.state.waitingFor).toContain("pipeline");
    // Once idle, the recheck installs.
    h.setBusy(null);
    h.timers.at(-1)!.fn();
    await flush();
    expect(h.quits).toBe(1);
    expect(updater.state.status).toBe("installing");
    const script = readFileSync(h.spawned[0][1], "utf8");
    expect(script).toContain(h.appimage);
    expect(script).toContain(String(process.pid));
  } finally {
    h.cleanup();
  }
});

test("a checksum mismatch discards the download and postponing stops the automatic restart", async () => {
  const bad = harness(new TextEncoder().encode("tampered"), { sha: "b".repeat(64) });
  try {
    const updater = new DesktopUpdater(bad.deps);
    await updater.check();
    expect(updater.state.status).toBe("error");
    expect(updater.state.message).toContain("checksum");
    expect(existsSync(join(bad.dir, "data/updates/0.2.5/linux-x64-ActDock.AppImage"))).toBe(false);
  } finally {
    bad.cleanup();
  }
  const ok = harness(new TextEncoder().encode("new build"));
  try {
    const updater = new DesktopUpdater(ok.deps);
    await updater.check();
    updater.postpone();
    expect(updater.state.installAt).toBeUndefined();
    ok.timers.at(-1)!.fn();
    await flush();
    expect(ok.quits).toBe(0);
    // Manual install still works after postponing.
    await updater.install();
    expect(ok.quits).toBe(1);
  } finally {
    ok.cleanup();
  }
});

test("with automatic downloads off, a new version is only announced", async () => {
  const h = harness(new TextEncoder().encode("new build"));
  try {
    const updater = new DesktopUpdater(h.deps);
    updater.setPreferences({ autoDownload: false });
    await updater.check();
    expect(updater.state.status).toBe("available");
    expect(h.notices).toEqual(["Act Dock 0.2.5 is available"]);
    // Preferences persist for the next launch.
    expect(new DesktopUpdater(h.deps).state.preferences.autoDownload).toBe(false);
  } finally {
    h.cleanup();
  }
});

test("the macOS helper swaps the app bundle after the old process exits and reopens it", () => {
  const dir = mkdtempSync(join(tmpdir(), "ad-swap-"));
  try {
    const app = join(dir, "Act Dock.app"),
      staging = join(dir, ".Act Dock.app.update-0.2.5"),
      staged = join(staging, "Act Dock.app");
    mkdirSync(join(app, "Contents"), { recursive: true });
    writeFileSync(join(app, "Contents", "version"), "old");
    mkdirSync(join(staged, "Contents"), { recursive: true });
    writeFileSync(join(staged, "Contents", "version"), "new");
    const reopened = join(dir, "reopened");
    const reopen = join(dir, "reopen.sh");
    writeFileSync(reopen, `#!/bin/sh\necho "$1" > ${JSON.stringify(reopened)}\n`, { mode: 0o755 });
    const exited = Bun.spawnSync(["true"]).pid;
    const script = join(dir, "install.sh");
    writeFileSync(script, macInstallScript(app, staged, [exited]));
    const result = Bun.spawnSync(["/bin/sh", script], {
      env: { ...process.env, ACT_DOCK_REOPEN: reopen },
    });
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(app, "Contents", "version"), "utf8")).toBe("new");
    expect(existsSync(staging)).toBe(false);
    expect(readFileSync(reopened, "utf8").trim()).toBe(app);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
