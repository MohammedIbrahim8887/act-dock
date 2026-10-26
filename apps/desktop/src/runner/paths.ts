import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
export function platformPaths(platform: string, home: string, env: NodeJS.ProcessEnv) {
  const directory = env.ACT_DOCK_DATA_DIR || (platform === "darwin"
    ? join(home, "Library", "Application Support", "Act Dock")
    : platform === "win32" ? join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "Act Dock")
    : join(env.XDG_DATA_HOME || join(home, ".local", "share"), "act-dock"));
  return {
    directory,
    socket: platform === "win32"
      ? "\\\\.\\pipe\\act-dock-" + createHash("sha256").update(directory.toLowerCase()).digest("hex").slice(0, 24)
      : join(directory, "runner.sock"),
    executable: join(directory, "bin", platform === "win32" ? "act-dock.exe" : "act-dock"),
  };
}
const paths = platformPaths(process.platform, homedir(), process.env);
export const dataDir =
  paths.directory;
export const socketPath = paths.socket;
export const executablePath = paths.executable;
export const tokenPath = join(dataDir, "runner.key");
export function preparePaths() {
  mkdirSync(join(dataDir, "logs"), { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(dataDir, 0o700);
}
