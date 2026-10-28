import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { arch, platform, release } from "node:os";
import { APP_VERSION } from "../shared/version";
import {
  AppError,
  activeStates,
  healthReportSchema,
  type HealthAction,
  type HealthCheckInput,
  type HealthReport,
} from "../shared/contracts";
import { binary } from "./process";
import { executionEnvironment } from "./executor/act";
import type { Images } from "./images";
import { bundledActPath, dataDir, executablePath } from "./paths";
import { RUNNER_IMAGE } from "./workflows";
import type { Store } from "./store";

const exec = promisify(execFile);
const GiB = 1024 ** 3;
const gb = (bytes: number) => `${(bytes / GiB).toFixed(bytes < 10 * GiB ? 1 : 0)} GB`;
const dockerInstallUrl =
  platform() === "darwin"
    ? "https://docs.docker.com/desktop/setup/install/mac-install/"
    : platform() === "win32"
      ? "https://docs.docker.com/desktop/setup/install/windows-install/"
      : "https://docs.docker.com/engine/install/";

type Run = (file: string, args: string[], timeout?: number) => Promise<{ ok: boolean; stdout: string; stderr: string }>;
const run: Run = async (file, args, timeout = 8000) => {
  try {
    const r = await exec(file, args, { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: executionEnvironment(file) });
    return { ok: true, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: (err.stdout || "").trim(), stderr: (err.stderr || err.message || "").trim() };
  }
};

// Fixes run in the background; their state shapes the next report.
let dockerStart: { at: number; via: string } | undefined;
let pull: { layers: Map<string, string>; error?: string; done?: boolean } | undefined;
let network: { at: number; ok: boolean } | undefined;

async function reachGitHub() {
  // Successes are cached for a minute; failures are retried sooner so a blip clears quickly.
  if (network && Date.now() - network.at < (network.ok ? 60_000 : 15_000)) return network.ok;
  let ok = false;
  try {
    const r = await fetch("https://github.com", { method: "HEAD", signal: AbortSignal.timeout(7000) });
    ok = r.status < 500;
  } catch {}
  network = { at: Date.now(), ok };
  return ok;
}

function pullProgress() {
  if (!pull || pull.done || pull.error) return undefined;
  const states = [...pull.layers.values()];
  const done = states.filter((s) => /Pull complete|Already exists/.test(s)).length;
  return states.length
    ? { label: `Downloading layer ${Math.min(done + 1, states.length)} of ${states.length}`, fraction: done / states.length }
    : { label: "Starting download…" };
}

export async function checkHealth(
  store: Store,
  options: { reachGitHub?: () => Promise<boolean>; images?: Images } = {},
): Promise<HealthReport> {
  const settings = store.settings();
  const checks: HealthCheckInput[] = [];
  const runnerImage=settings.executionDefaults?.runnerMappings?.["ubuntu-latest"]||RUNNER_IMAGE;
  const docker = binary("docker", settings.dockerPath);

  // Docker CLI and engine
  let engine: Record<string, unknown> | undefined;
  if (!docker) {
    checks.push({
      id: "docker-cli", group: "required", status: "error",
      title: "Docker",
      summary: settings.dockerPath ? "The Docker path in Settings doesn’t exist" : "Docker isn’t installed",
      detail: "act runs every job inside a container, so Act Dock needs Docker. Install Docker Desktop (or another Docker engine), then check again.",
      facts: settings.dockerPath ? [{ label: "Configured path", value: settings.dockerPath, mono: true }] : [],
      action: settings.dockerPath
        ? { kind: "view", target: "settings", label: "Fix in Settings" }
        : { kind: "link", url: dockerInstallUrl, label: "Install Docker" },
    });
  } else {
    const info = await run(docker, ["info", "--format", "{{json .}}"]);
    try { engine = JSON.parse(info.stdout) as Record<string, unknown>; } catch {}
    const serverError = engine && typeof engine.ServerErrors === "object" && engine.ServerErrors ? String(engine.ServerErrors) : "";
    const running = info.ok && engine && !serverError && typeof engine.ServerVersion === "string" && engine.ServerVersion;
    const starting = dockerStart && Date.now() - dockerStart.at < 120_000;
    const text = (info.stderr + " " + serverError).toLowerCase();
    if (running && engine?.OSType === "windows") {
      checks.push({
        id: "docker-engine", group: "required", status: "error", title: "Docker engine",
        summary: "Docker is using Windows containers",
        detail: "act needs Linux containers. Right-click the Docker Desktop icon in the system tray and choose “Switch to Linux containers…”.",
      });
      engine = undefined;
    } else if (running) {
      dockerStart = undefined;
      checks.push({
        id: "docker-engine", group: "required", status: "ok", title: "Docker engine",
        summary: `Running · Docker ${engine!.ServerVersion}`,
        facts: [
          { label: "Engine", value: String(engine!.ServerVersion) },
          { label: "Runtime", value: String(engine!.OperatingSystem || "Docker") },
          { label: "Architecture", value: String(engine!.Architecture || "unknown") },
          { label: "CLI", value: docker, mono: true },
        ],
      });
    } else if (text.includes("permission denied")) {
      engine = undefined;
      checks.push({
        id: "docker-engine", group: "required", status: "error", title: "Docker engine",
        summary: "Your account can’t use Docker",
        detail: "Docker is running but your user isn’t allowed to talk to it. Add yourself to the docker group, then sign out and back in.",
        command: "sudo usermod -aG docker $USER",
      });
    } else {
      engine = undefined;
      checks.push({
        id: "docker-engine", group: "required", status: starting ? "pending" : "error", title: "Docker engine",
        summary: starting ? `Starting ${dockerStart!.via}…` : "Docker isn’t running",
        detail: starting
          ? "This usually takes 10–30 seconds. Act Dock checks again automatically."
          : "Docker is installed but its engine isn’t answering. Start it and pipelines can run. Queued runs wait until it’s back.",
        facts: [{ label: "CLI", value: docker, mono: true }],
        action: starting ? undefined : { kind: "runner", id: "start_docker", label: "Start Docker" },
        command: platform() === "linux" && !starting ? "sudo systemctl start docker" : undefined,
      });
    }
  }

  // Docker resources
  if (engine) {
    const cpus = Number(engine.NCPU) || 0, memory = Number(engine.MemTotal) || 0;
    const low = memory > 0 && memory < 4 * GiB;
    checks.push({
      id: "docker-resources", group: "recommended", status: low || (cpus > 0 && cpus < 2) ? "warning" : "ok",
      title: "Docker resources",
      summary: `${cpus} CPU${cpus === 1 ? "" : "s"} · ${gb(memory)} memory`,
      detail: low ? "Builds, test suites, and browsers can run out of memory below 4 GB. Raise the limit in Docker Desktop → Settings → Resources." : undefined,
      facts: [{ label: "CPUs", value: String(cpus) }, { label: "Memory", value: gb(memory) }],
    });
  } else {
    checks.push({ id: "docker-resources", group: "recommended", status: "skipped", title: "Docker resources", summary: "Shown once Docker is running" });
  }

  // act engine
  const act = binary("act", settings.actPath, bundledActPath);
  const actVersion = act ? await run(act, ["--version"], 5000) : undefined;
  const source = !act ? "" : act === settings.actPath ? "Custom path" : act === bundledActPath ? "Bundled with Act Dock" : "System install";
  checks.push(
    act && actVersion?.ok
      ? {
          id: "act", group: "required", status: "ok", title: "act engine",
          summary: `${actVersion.stdout.replace(/^act version\s*/i, "v")} · ${source.toLowerCase()}`,
          facts: [
            { label: "Version", value: actVersion.stdout.replace(/^act version\s*/i, "") },
            { label: "Source", value: source },
            { label: "Path", value: act, mono: true },
          ],
        }
      : {
          id: "act", group: "required", status: "error", title: "act engine",
          summary: !act ? (settings.actPath ? "The act path in Settings doesn’t exist" : "The bundled act engine is missing") : "act couldn’t start",
          detail: settings.actPath
            ? "Clear the custom path in Settings to use the engine bundled with Act Dock."
            : "Reinstall Act Dock to restore its bundled engine, or choose an act executable in Settings.",
          facts: act ? [{ label: "Path", value: act, mono: true }] : [],
          action: { kind: "view", target: "settings", label: "Open Settings" },
        },
  );

  // Job image
  if (engine && docker) {
    const image = await run(docker, ["image", "inspect", runnerImage, "--format", "{{.Size}}"]);
    const operation=options.images?.list().find(o=>o.reference===runnerImage&&o.state==="pulling");
    const progress = operation?{label:operation.detail,fraction:operation.fraction}:pullProgress();
    if (image.ok) pull = undefined;
    checks.push(
      image.ok
        ? {
            id: "runner-image", group: "recommended", status: "ok", title: "Job image",
            summary: `Downloaded · ${gb(Number(image.stdout) || 0)}`,
            facts: [{ label: "Image", value: runnerImage, mono: true }, { label: "Size", value: gb(Number(image.stdout) || 0) }],
          }
        : {
            id: "runner-image", group: "recommended", status: progress ? "pending" : "warning", title: "Job image",
            summary: progress ? "Downloading…" : pull?.error ? "Download failed" : "Not downloaded yet",
            detail: pull?.error
              ? pull.error
              : "Jobs on ubuntu-latest use this configured image. Download it before the first run. Image size depends on the selected medium, full or custom preset.",
            facts: [{ label: "Image", value: runnerImage, mono: true }],
            progress,
            action: progress ? undefined : { kind: "runner", id: "pull_image", label: pull?.error ? "Try again" : "Download now" },
          },
    );
  } else {
    checks.push({ id: "runner-image", group: "recommended", status: "skipped", title: "Job image", summary: "Shown once Docker is running" });
  }

  // Disk space where Act Dock keeps logs (and usually where Docker stores images)
  try {
    const fs = statfsSync(dataDir);
    const free = fs.bavail * fs.bsize, total = fs.blocks * fs.bsize;
    checks.push({
      id: "disk", group: "recommended", status: free < 2 * GiB ? "error" : free < 10 * GiB ? "warning" : "ok",
      title: "Disk space",
      summary: `${gb(free)} free of ${gb(total)}`,
      detail: free < 10 * GiB ? "Images, caches, and build output need room. Free some space or prune unused Docker data." : undefined,
      command: free < 10 * GiB ? "docker system prune" : undefined,
      facts: [{ label: "Free", value: gb(free) }, { label: "Data folder", value: dataDir, mono: true }],
    });
  } catch {
    checks.push({ id: "disk", group: "recommended", status: "skipped", title: "Disk space", summary: "Couldn’t read free space" });
  }

  // Network: act fetches remote actions (like actions/checkout) from GitHub.
  const online = await (options.reachGitHub ?? reachGitHub)();
  checks.push({
    id: "network", group: "recommended", status: online ? "ok" : "warning", title: "GitHub access",
    summary: online ? "github.com is reachable" : "Can’t reach github.com",
    detail: online ? undefined : "Workflows that use remote actions, like actions/checkout, download them from GitHub the first time. Actions you’ve already used are cached.",
  });

  // Agents
  checks.push(
    existsSync(executablePath)
      ? {
          id: "agents", group: "recommended", status: "ok", title: "Agent connections",
          summary: "Ready for MCP and the CLI",
          facts: [{ label: "Command", value: executablePath, mono: true }],
          action: { kind: "view", target: "agents", label: "Connect an agent" },
        }
      : {
          id: "agents", group: "recommended", status: "warning", title: "Agent connections",
          summary: "The command-line runner isn’t installed yet",
          detail: "Open the packaged Act Dock app once to install the runner that MCP clients and the CLI use.",
        },
  );

  // Environment
  const active = store.listRuns({}, 0, 200).filter((r) => activeStates.includes(r.state)).length;
  checks.push({
    id: "runner", group: "environment", status: "ok", title: "Background runner",
    summary: `Running · ${active ? `${active} active run${active === 1 ? "" : "s"}` : "idle"}`,
    facts: [
      { label: "Version", value: APP_VERSION },
      { label: "Up for", value: uptime(process.uptime()) },
      { label: "Data folder", value: dataDir, mono: true },
    ],
  });
  const appleSilicon = platform() === "darwin" && arch() === "arm64";
  checks.push({
    id: "platform", group: "environment", status: "info", title: "This computer",
    summary: `${platformName()} · ${appleSilicon ? "Apple Silicon" : arch()}`,
    detail: appleSilicon
      ? "Jobs run as linux/arm64 containers. If an action only ships x86 binaries, run with the linux/amd64 architecture option."
      : undefined,
    facts: [{ label: "System", value: `${platformName()} ${release()}` }, { label: "Architecture", value: arch() }],
  });

  const required = checks.filter((c) => c.group === "required");
  const overall = required.some((c) => c.status === "error" || c.status === "pending")
    ? "blocked"
    : checks.some((c) => c.status === "warning" || c.status === "error" || c.status === "pending")
      ? "attention"
      : "ready";
  return healthReportSchema.parse({ checkedAt: new Date().toISOString(), overall, checks });
}

export async function fixHealth(store: Store, action: HealthAction): Promise<{ message: string }> {
  const settings = store.settings();
  const docker = binary("docker", settings.dockerPath);
  if (action === "start_docker") {
    const via = await startDocker();
    dockerStart = { at: Date.now(), via };
    return { message: `Starting ${via}` };
  }
  if (!docker) throw new AppError("DOCKER_UNAVAILABLE", "Install Docker first.");
  if (pull && !pull.done && !pull.error) return { message: "Already downloading" };
  const job: NonNullable<typeof pull> = { layers: new Map() };
  pull = job;
  const child = spawn(docker, ["pull", RUNNER_IMAGE], { windowsHide: true });
  let tail = "";
  const read = (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      const m = /^([0-9a-f]{12}): (.+)$/.exec(line.trim());
      if (m) job.layers.set(m[1], m[2]);
      else if (line.trim()) tail = line.trim();
    }
  };
  child.stdout.on("data", read);
  child.stderr.on("data", read);
  child.on("close", (code) => {
    if (code === 0) job.done = true;
    else job.error = tail || "docker pull failed. Check your connection and Docker, then try again.";
  });
  child.on("error", (e) => { job.error = e.message; });
  return { message: "Downloading " + RUNNER_IMAGE };
}

async function startDocker(): Promise<string> {
  const os = platform();
  const detach = (file: string, args: string[]) => {
    const child = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
  };
  if (os === "darwin") {
    for (const [app, label] of [["Docker", "Docker Desktop"], ["OrbStack", "OrbStack"]] as const) {
      if (existsSync(`/Applications/${app}.app`) || existsSync(join(process.env.HOME || "", "Applications", `${app}.app`))) {
        if ((await run("/usr/bin/open", ["-a", app])).ok) return label;
      }
    }
    const colima = binary("colima");
    if (colima) { detach(colima, ["start"]); return "Colima"; }
  } else if (os === "win32") {
    const exe = join(process.env.ProgramFiles || "C:\\Program Files", "Docker", "Docker", "Docker Desktop.exe");
    if (existsSync(exe)) { detach(exe, []); return "Docker Desktop"; }
  } else {
    const desktop = await run("systemctl", ["--user", "cat", "docker-desktop"], 4000);
    if (desktop.ok && (await run("systemctl", ["--user", "start", "docker-desktop"], 15000)).ok) return "Docker Desktop";
    throw new AppError("DOCKER_START_UNSUPPORTED", "Start the Docker service from a terminal: sudo systemctl start docker");
  }
  throw new AppError("DOCKER_START_UNSUPPORTED", "Couldn’t find Docker Desktop to open. Start your Docker engine manually, then check again.");
}

function uptime(seconds: number) {
  const m = Math.floor(seconds / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : m ? `${m}m` : `${Math.floor(seconds)}s`;
}
function platformName() {
  return { darwin: "macOS", win32: "Windows", linux: "Linux" }[platform() as string] || platform();
}
