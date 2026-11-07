import { createHash, randomBytes } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  assetFor,
  defaultUpdatePreferences,
  detectInstall,
  isNewerVersion,
  parseManifest,
  updateFeed,
  type InstallKind,
  type ReleaseAsset,
  type UpdatePreferences,
  type UpdateState,
} from "../shared/updates";

const CHECK_INTERVAL = 4 * 60 * 60_000;
const FIRST_CHECK_DELAY = 15_000;
/** Visible countdown before an automatic restart, so it never surprises anyone. */
export const AUTO_INSTALL_DELAY = 60_000;
const BUSY_RECHECK = 30_000;

export type UpdaterDeps = {
  version: string;
  channel: string;
  platform: string;
  arch: string;
  execPath: string;
  env: Record<string, string | undefined>;
  dataDir: string;
  /** A sentence describing active work that should delay a restart, or null. */
  busy: () => Promise<string | null>;
  notify: (title: string, body: string) => void;
  /** Ask the app to quit. Returns false when something vetoed it. */
  quit: () => boolean;
  /** Run a short command and return its exit code and output. */
  exec: (cmd: string[]) => { code: number; stdout: string };
  /** Start a helper that outlives the app. */
  spawnDetached: (cmd: string[]) => void;
  fetch: typeof fetch;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
};

/** Single-quote a value for POSIX sh. */
const sh = (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;
/** Single-quote a value for PowerShell. */
const ps = (v: string) => `'${v.replaceAll("'", "''")}'`;

const waitForPids = `for pid in $PIDS; do
  i=0
  while kill -0 "$pid" 2>/dev/null; do
    i=$((i+1)); [ "$i" -gt 600 ] && exit 1
    sleep 0.1
  done
done`;

/** Replace the .app once the old one has quit, rolling back if the swap fails. */
export function macInstallScript(app: string, staged: string, pids: number[]) {
  return `#!/bin/sh
APP=${sh(app)}
STAGED=${sh(staged)}
PIDS=${sh(pids.join(" "))}
${waitForPids}
BACKUP="$APP.previous-$$"
if mv "$APP" "$BACKUP"; then
  if mv "$STAGED" "$APP"; then rm -rf "$BACKUP"; else mv "$BACKUP" "$APP"; fi
fi
rm -rf "$(dirname "$STAGED")"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null
"\${ACT_DOCK_REOPEN:-open}" "$APP"
`;
}
export function appImageInstallScript(target: string, update: string, pids: number[]) {
  return `#!/bin/sh
TARGET=${sh(target)}
UPDATE=${sh(update)}
PIDS=${sh(pids.join(" "))}
${waitForPids}
if cp "$UPDATE" "$TARGET.new" && chmod 755 "$TARGET.new" && mv -f "$TARGET.new" "$TARGET"; then rm -f "$UPDATE"; else rm -f "$TARGET.new"; fi
nohup "$TARGET" >/dev/null 2>&1 &
`;
}
export function linuxPackageScript(kind: "deb" | "rpm", pkg: string, pids: number[]) {
  const install = kind === "deb" ? `pkexec dpkg -i "$PKG"` : `pkexec rpm -U --replacepkgs "$PKG"`;
  return `#!/bin/sh
PKG=${sh(pkg)}
PIDS=${sh(pids.join(" "))}
${waitForPids}
${install}
nohup /usr/bin/act-dock-desktop >/dev/null 2>&1 &
`;
}
/** Silent per-user NSIS install into the current folder, then relaunch. */
export function windowsInstallScript(
  installer: string,
  installDir: string,
  exe: string,
  pids: number[],
  task: string,
) {
  return `$ErrorActionPreference = 'SilentlyContinue'
foreach ($p in @(${pids.join(",")})) { Wait-Process -Id $p -Timeout 120 }
Start-Process -FilePath ${ps(installer)} -ArgumentList ${ps(`/S /D=${installDir}`)} -Wait
Start-Process -FilePath ${ps(exe)}
Unregister-ScheduledTask -TaskName ${ps(task)} -Confirm:$false
`;
}
/** A scheduled task escapes the app's job object, so the helper survives the quit. */
export function windowsTaskScript(task: string, script: string) {
  const args = `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}"`;
  return `$ErrorActionPreference = 'Stop'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${ps(args)}
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName ${ps(task)} -Action $action -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName ${ps(task)}
`;
}

type Prepared = {
  version: string;
  file: string;
  /** macOS: the verified app bundle staged beside the installed one. */
  staged?: string;
};

export class DesktopUpdater {
  state: UpdateState;
  private root?: string;
  private asset?: ReleaseAsset;
  private prepared?: Prepared;
  private notified = new Set<string>();
  private postponed = false;
  private installTimer?: unknown;
  private checking?: Promise<void>;
  private downloading?: Promise<void>;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (t: unknown) => void;

  constructor(private deps: UpdaterDeps) {
    this.now = deps.now || Date.now;
    this.setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer || ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    const install = detectInstall(deps.platform, deps.arch, deps.execPath, deps.env, deps.channel);
    let kind = install.kind;
    if (kind === "linux-deb" && deps.exec(["rpm", "-q", "act-dock"]).code === 0) kind = "linux-rpm";
    this.root = install.root;
    this.state = {
      status: kind === "development" || kind === "unsupported" ? "unavailable" : "idle",
      currentVersion: deps.version,
      installKind: kind,
      message: install.reason,
      needsAdmin: kind === "linux-deb" || kind === "linux-rpm",
      preferences: this.loadPreferences(),
    };
  }
  private get folder() {
    return join(this.deps.dataDir, "updates");
  }
  private loadPreferences(): UpdatePreferences {
    try {
      const saved = JSON.parse(readFileSync(join(this.folder, "preferences.json"), "utf8"));
      return {
        autoDownload: typeof saved.autoDownload === "boolean" ? saved.autoDownload : defaultUpdatePreferences.autoDownload,
        autoInstall: typeof saved.autoInstall === "boolean" ? saved.autoInstall : defaultUpdatePreferences.autoInstall,
      };
    } catch {
      return { ...defaultUpdatePreferences };
    }
  }
  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
  }

  /** Start background checks. Safe to call once at launch. */
  start() {
    if (this.state.status === "unavailable") return;
    this.cleanupStale();
    this.setTimer(() => void this.check(), FIRST_CHECK_DELAY);
    const loop = () => {
      this.setTimer(() => {
        void this.check();
        loop();
      }, CHECK_INTERVAL);
    };
    loop();
  }

  setPreferences(next: Partial<UpdatePreferences>) {
    const preferences = { ...this.state.preferences, ...next };
    mkdirSync(this.folder, { recursive: true });
    writeFileSync(join(this.folder, "preferences.json"), JSON.stringify(preferences));
    this.set({ preferences });
    if (preferences.autoDownload && this.state.status === "available") void this.download();
    if (this.state.status === "ready") {
      if (preferences.autoInstall) this.scheduleInstall();
      else this.cancelScheduledInstall();
    }
    return this.state;
  }

  check(): Promise<void> {
    if (this.state.status === "unavailable") return Promise.resolve();
    if (["downloading", "ready", "installing"].includes(this.state.status)) return Promise.resolve();
    return (this.checking ||= this.runCheck().finally(() => (this.checking = undefined)));
  }
  private async runCheck() {
    this.set({ status: "checking", message: undefined });
    try {
      const feed = updateFeed(this.deps.env);
      const response = await this.deps.fetch(`${feed.manifest}?t=${this.now()}`, {
        signal: AbortSignal.timeout(20_000),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`The release server answered ${response.status}.`);
      const manifest = parseManifest(await response.json(), feed.assets);
      const checkedAt = new Date(this.now()).toISOString();
      if (!isNewerVersion(manifest.version, this.deps.version)) {
        this.set({ status: "idle", checkedAt, version: undefined });
        return;
      }
      const asset = assetFor(manifest, this.state.installKind);
      if (!asset) throw new Error(`Act Dock ${manifest.version} has no download for this system yet.`);
      this.asset = asset;
      this.set({
        status: "available",
        version: manifest.version,
        publishedAt: manifest.publishedAt,
        checkedAt,
        totalBytes: asset.size,
      });
      if (this.state.preferences.autoDownload) await this.download();
      else if (!this.notified.has(manifest.version)) {
        this.notified.add(manifest.version);
        this.deps.notify(
          `Act Dock ${manifest.version} is available`,
          "Open Settings › Updates to download and install it.",
        );
      }
    } catch (error) {
      this.set({ status: "error", message: describe(error, "Couldn't check for updates. Check your connection and try again.") });
    }
  }

  download(): Promise<void> {
    if (this.state.status !== "available" && this.state.status !== "error") return this.downloading || Promise.resolve();
    if (!this.asset || !this.state.version) return Promise.resolve();
    return (this.downloading ||= this.runDownload(this.asset, this.state.version).finally(
      () => (this.downloading = undefined),
    ));
  }
  private async runDownload(asset: ReleaseAsset, version: string) {
    const dir = join(this.folder, version);
    const file = join(dir, asset.name);
    try {
      mkdirSync(dir, { recursive: true });
      if (!(existsSync(file) && sha256File(file) === asset.sha256)) {
        this.set({ status: "downloading", progress: 0, downloadedBytes: 0, totalBytes: asset.size, message: undefined });
        const response = await this.deps.fetch(asset.url, { redirect: "follow" });
        if (!response.ok || !response.body) throw new Error(`The download failed (${response.status}).`);
        const partial = `${file}.partial`;
        const hash = createHash("sha256");
        const writer = Bun.file(partial).writer();
        let received = 0;
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          hash.update(chunk);
          writer.write(chunk);
          received += chunk.byteLength;
          if (received > asset.size) throw new Error("The download is larger than the release says.");
          this.set({ downloadedBytes: received, progress: received / asset.size });
        }
        await writer.end();
        if (received !== asset.size || hash.digest("hex") !== asset.sha256) {
          rmSync(partial, { force: true });
          throw new Error("The download didn't match the release checksum, so it was discarded.");
        }
        renameSync(partial, file);
      }
      this.set({ status: "downloading", progress: 1, message: "Verifying…" });
      this.prepared = { version, file, staged: this.prepare(file, version) };
      this.set({ status: "ready", progress: 1, message: undefined });
      if (!this.notified.has(`ready-${version}`)) {
        this.notified.add(`ready-${version}`);
        this.deps.notify(
          `Act Dock ${version} is ready`,
          this.state.preferences.autoInstall
            ? "It installs automatically when no pipelines are running. Act Dock will reopen."
            : "Restart Act Dock from Settings › Updates to install it.",
        );
      }
      if (this.state.preferences.autoInstall) this.scheduleInstall();
    } catch (error) {
      this.set({ status: "error", progress: undefined, message: describe(error, "The update couldn't be downloaded.") });
    }
  }

  /** Platform checks that can run before quitting, so the swap itself is tiny. */
  private prepare(file: string, version: string): string | undefined {
    const kind = this.state.installKind;
    if (kind === "macos-app") {
      const app = this.root!;
      const parent = dirname(app);
      if (!writable(parent))
        throw new Error(`Act Dock can't write to ${parent}. Move it to your Applications folder and try again.`);
      const mount = join(this.folder, version, `mount-${randomBytes(4).toString("hex")}`);
      mkdirSync(mount, { recursive: true });
      const attach = this.deps.exec(["hdiutil", "attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount, file]);
      if (attach.code !== 0) throw new Error("The downloaded disk image couldn't be opened.");
      try {
        const bundle = readdirSync(mount).find((n) => n.endsWith(".app"));
        if (!bundle) throw new Error("The disk image doesn't contain Act Dock.");
        const source = join(mount, bundle);
        const plist = join(source, "Contents", "Info.plist");
        const read = (key: string) => this.deps.exec(["/usr/bin/plutil", "-extract", key, "raw", "-o", "-", plist]).stdout.trim();
        if (read("CFBundleIdentifier") !== "sh.actdock.desktop") throw new Error("The download isn't an Act Dock build.");
        if (this.deps.exec(["codesign", "--verify", "--deep", "--strict", source]).code !== 0)
          throw new Error("The new version's code signature is invalid, so it wasn't installed.");
        const stagingDir = join(parent, `.${basename(app)}.update-${version}`);
        rmSync(stagingDir, { recursive: true, force: true });
        mkdirSync(stagingDir);
        const staged = join(stagingDir, basename(app));
        if (this.deps.exec(["ditto", source, staged]).code !== 0) throw new Error("The new version couldn't be copied next to the installed one.");
        return staged;
      } finally {
        this.deps.exec(["hdiutil", "detach", mount, "-quiet", "-force"]);
        rmSync(mount, { recursive: true, force: true });
      }
    }
    if (kind === "linux-appimage") {
      if (!writable(dirname(this.root!)))
        throw new Error(`Act Dock can't replace ${this.root}. Move the AppImage to a folder you own.`);
      chmodSync(file, 0o755);
    }
    if ((kind === "linux-deb" || kind === "linux-rpm") && this.deps.exec(["sh", "-c", "command -v pkexec"]).code !== 0)
      throw new Error("Installing needs pkexec to ask for your password. Install the package from the website instead.");
    return undefined;
  }

  private scheduleInstall() {
    if (this.postponed || this.state.status !== "ready") return;
    this.cancelScheduledInstall();
    const installAt = this.now() + AUTO_INSTALL_DELAY;
    this.set({ installAt, waitingFor: undefined });
    this.installTimer = this.setTimer(() => void this.autoInstall(), AUTO_INSTALL_DELAY);
  }
  private cancelScheduledInstall() {
    if (this.installTimer) this.clearTimer(this.installTimer);
    this.installTimer = undefined;
    this.set({ installAt: undefined, waitingFor: undefined });
  }
  private async autoInstall() {
    this.installTimer = undefined;
    if (this.postponed || this.state.status !== "ready") return;
    const busy = await this.deps.busy().catch(() => null);
    if (busy) {
      this.set({ installAt: undefined, waitingFor: busy });
      this.installTimer = this.setTimer(() => void this.autoInstall(), BUSY_RECHECK);
      return;
    }
    await this.install().catch(() => {});
  }
  /** Skip the automatic restart for this session. Manual install still works. */
  postpone() {
    this.postponed = true;
    this.cancelScheduledInstall();
    return this.state;
  }

  /** Quit, let the helper install the update, and reopen Act Dock. */
  async install() {
    const prepared = this.prepared;
    if (this.state.status !== "ready" || !prepared) throw new Error("No update is ready to install.");
    this.cancelScheduledInstall();
    this.set({ status: "installing", message: undefined });
    try {
      const pids = [process.pid, Number(this.deps.env.ELECTROBUN_LAUNCHER_PID)].filter(
        (p) => Number.isInteger(p) && p > 0,
      );
      const dir = dirname(prepared.file);
      const kind = this.state.installKind;
      if (kind === "windows-installer") {
        const task = `ActDockUpdate_${randomBytes(8).toString("hex")}`;
        const exe = join(this.root!, "bin", "Act Dock.exe");
        const script = join(dir, "install.ps1");
        writeFileSync(script, windowsInstallScript(prepared.file, this.root!, exe, pids, task));
        const register = join(dir, "register.ps1");
        writeFileSync(register, windowsTaskScript(task, script));
        const result = this.deps.exec(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", register]);
        if (result.code !== 0) throw new Error("Windows wouldn't start the installer task.");
      } else {
        const script = join(dir, "install.sh");
        const body =
          kind === "macos-app"
            ? macInstallScript(this.root!, prepared.staged!, pids)
            : kind === "linux-appimage"
              ? appImageInstallScript(this.root!, prepared.file, pids)
              : linuxPackageScript(kind === "linux-rpm" ? "rpm" : "deb", prepared.file, pids);
        writeFileSync(script, body, { mode: 0o700 });
        this.deps.spawnDetached(["/bin/sh", script]);
      }
      if (!this.deps.quit()) throw new Error("Act Dock couldn't quit to install the update.");
    } catch (error) {
      this.set({ status: "ready", message: describe(error, "The update couldn't be installed.") });
      throw error;
    }
  }

  /** Remove downloads for versions that are no longer needed. */
  private cleanupStale() {
    try {
      for (const name of readdirSync(this.folder))
        if (/^\d+\.\d+\.\d+$/.test(name) && !isNewerVersion(name, this.deps.version))
          rmSync(join(this.folder, name), { recursive: true, force: true });
    } catch {}
  }
}

function writable(path: string) {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
function sha256File(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function describe(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
export type { InstallKind };
