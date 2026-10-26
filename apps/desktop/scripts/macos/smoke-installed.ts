import { mkdtemp, mkdir, rm, open } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { run } from "../build-brand";
import { APP_VERSION } from "../../src/shared/version";

// Run the real copied application with isolated state; never write to /Applications.
const temporary = await mkdtemp("/tmp/ad-installed-");
const copiedApp = join(temporary, "Act Dock.app");
const data = join(temporary, "data");
await mkdir(data);
const sourceApp = resolve(
  process.argv[2] || "/Volumes/Install Act Dock/Act Dock.app",
);
await run(["/usr/bin/ditto", sourceApp, copiedApp]);
const log = await open(join(temporary, "launch.log"), "a");
const executable = join(copiedApp, "Contents/MacOS/launcher");
const child = spawn(executable, [], {
  cwd: join(copiedApp, "Contents/MacOS"),
  detached: true,
  env: { ...process.env, ACT_DOCK_DATA_DIR: data },
  stdio: ["ignore", log.fd, log.fd],
});
const socket = join(data, "runner.sock");
async function rpc(method: string) {
  const response = await fetch("http://localhost/rpc", {
    unix: socket,
    headers: { Authorization: "Bearer " + (await Bun.file(join(data, "runner.key")).text()).trim() },
    method: "POST",
    body: JSON.stringify({ method, params: {} }),
    signal: AbortSignal.timeout(1000),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.error?.message || "RPC failed");
  return result.data;
}
let success = false;
try {
  const until = Date.now() + 25000;
  while (Date.now() < until) {
    try {
      await rpc("get_settings");
      success = true;
      break;
    } catch {
      await Bun.sleep(200);
    }
  }
  if (!success)
    throw new Error(
      "Copied app did not establish its desktop-to-runner connection. See " +
        temporary,
    );
  const cli = join(data, "bin/act-dock");
  if (!(await Bun.file(cli).exists())) throw new Error("Installed CLI missing");
  await mkdir(".impeccable/review", { recursive: true });
  const report = {
    copiedAppLaunch: true,
    desktopRunnerConnection: true,
    installedCLI: true,
    source: sourceApp,
    version: APP_VERSION,
    isolatedData: true,
  };
  await Bun.write(
    ".impeccable/review/installer-launch.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (child.pid)
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  await rpc("stop").catch(() => {});
  await log.close();
  if (success) {
    await Bun.sleep(700);
    await rm(temporary, { recursive: true, force: true });
  }
}
