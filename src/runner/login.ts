import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dataDir, executablePath } from "./paths";
import { AppError } from "../shared/contracts";
const exec = promisify(execFile);
const label = "sh.actdock.runner";
const xml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export function loginPlist(executable: string, logFile: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(executable)}</string><string>runner</string><string>start</string></array><key>RunAtLoad</key><true/><key>StandardErrorPath</key><string>${xml(logFile)}</string></dict></plist>`;
}
type LoginEnvironment = {
  platform: string;
  path: string;
  executable: string;
  logFile: string;
  uid: number;
  launchctl: (args: string[]) => Promise<unknown>;
};
const environment = (): LoginEnvironment => ({
  platform: process.platform,
  path: join(homedir(), "Library/LaunchAgents", label + ".plist"),
  executable: executablePath,
  logFile: join(dataDir, "runner.log"),
  uid: process.getuid?.() || 0,
  launchctl: (args) => exec("/bin/launchctl", args, { timeout: 5000 }),
});
export async function setLogin(
  enabled: boolean,
  env: LoginEnvironment = environment(),
) {
  if (env.platform !== "darwin")
    throw new AppError(
      "UNSUPPORTED_PLATFORM",
      "Start at login is available on macOS.",
    );
  const domain = `gui/${env.uid}`;
  if (enabled) {
    if (!(await Bun.file(env.executable).exists()))
      throw new AppError(
        "RUNNER_NOT_INSTALLED",
        "Open the packaged desktop app once to install the runner.",
      );
    await mkdir(dirname(env.path), { recursive: true });
    await writeFile(env.path, loginPlist(env.executable, env.logFile), {
      mode: 0o600,
    });
    try {
      await env.launchctl(["bootstrap", domain, env.path]);
    } catch (e) {
      try {
        await env.launchctl(["print", `${domain}/${label}`]);
      } catch {
        await unlink(env.path).catch(() => {});
        throw e;
      }
    }
  } else {
    // A stopped or unloaded agent is already disabled. For any other error, confirm
    // it is unloaded before removing the file so the UI cannot promise a false state.
    try {
      await env.launchctl(["bootout", domain, env.path]);
    } catch (e) {
      let loaded = false;
      try {
        await env.launchctl(["print", `${domain}/${label}`]);
        loaded = true;
      } catch {}
      if (loaded) throw e;
    }
    await unlink(env.path).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
