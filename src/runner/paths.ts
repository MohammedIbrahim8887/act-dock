import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, chmodSync } from "node:fs";
export const dataDir =
  process.env.ACT_DOCK_DATA_DIR ||
  join(homedir(), "Library", "Application Support", "Act Dock");
export const socketPath = join(dataDir, "runner.sock");
export const executablePath = join(dataDir, "bin", "act-dock");
export function preparePaths() {
  mkdirSync(join(dataDir, "logs"), { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
}
