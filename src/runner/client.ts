import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  chmodSync,
  copyFileSync,
  renameSync,
  readFileSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import {
  AppError,
  parseResponse,
  serviceReplySchema,
  type Method,
  type Results,
  type Run,
} from "../shared/contracts";
import { dataDir, socketPath, executablePath, preparePaths } from "./paths";
export async function request<M extends Method>(
  method: M,
  params: unknown = {},
  source: Run["source"] = "cli",
): Promise<Results[M]> {
  const response = await fetch("http://localhost/rpc", {
    unix: socketPath,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params, source }),
    signal: AbortSignal.timeout(15000),
  });
  const result = serviceReplySchema.parse(await response.json());
  if (!result.ok) throw new AppError(result.error.code, result.error.message);
  return parseResponse(method, result.data);
}
export async function isAlive() {
  try {
    await request("get_settings");
    return true;
  } catch {
    return false;
  }
}
let pending: Promise<void> | undefined;
export function ensureRunner() {
  return (pending ||= startRunner().finally(() => {
    pending = undefined;
  }));
}
async function startRunner() {
  if (await isAlive()) return;
  preparePaths();
  const installed = existsSync(executablePath);
  const command = installed ? executablePath : process.execPath;
  const args = installed || import.meta.dir.startsWith("/$bunfs/")
    ? ["serve"]
    : [resolve(import.meta.dir, "../cli/index.ts"), "serve"];
  const fd = openSync(join(dataDir, "runner.log"), "a", 0o600);
  const child = spawn(command, args, {
    detached: true,
    stdio: ["ignore", fd, fd],
    env: process.env,
  });
  child.on("error", () => {});
  child.unref();
  closeSync(fd);
  for (let i = 0; i < 100; i++) {
    await Bun.sleep(100);
    if (await isAlive()) return;
  }
  throw new AppError(
    "RUNNER_UNAVAILABLE",
    `Runner did not start. Inspect ${join(dataDir, "runner.log")}.`,
  );
}
export async function call<M extends Method>(
  method: M,
  params: unknown = {},
  source: Run["source"] = "cli",
) {
  await ensureRunner();
  return request(method, params, source);
}
export async function installRunner(source: string) {
  preparePaths();
  mkdirSync(dirname(executablePath), { recursive: true, mode: 0o700 });
  if (source === executablePath) return;
  const hash = (p: string) =>
    createHash("sha256").update(readFileSync(p)).digest("hex");
  if (existsSync(executablePath) && hash(source) === hash(executablePath))
    return;
  if (await isAlive()) {
    const runs = await request("list_runs");
    if (runs.some((r) => ["queued", "running", "cancelling"].includes(r.state)))
      return; // Install on next app launch after active work drains.
    await request("stop");
    for (let i = 0; i < 100 && (await isAlive()); i++) await Bun.sleep(100);
    if (await isAlive())
      throw new AppError(
        "RUNNER_BUSY",
        "Runner is still stopping. Reopen Act Dock after it finishes.",
      );
  }
  const temp = executablePath + "." + process.pid + ".tmp";
  copyFileSync(source, temp);
  chmodSync(temp, 0o700);
  renameSync(temp, executablePath);
}
