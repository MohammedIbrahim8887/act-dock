import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { AppError } from "../shared/contracts";
import { dataDir } from "./paths";

export function helperPath() {
  const name =
    process.platform === "win32" ? "act-dock-helper.exe" : "act-dock-helper";
  const candidates = [
    process.env.ACT_DOCK_HELPER_PATH,
    join(dataDir, "bin", name),
    ...(import.meta.dir.includes("$bunfs") || import.meta.dir.includes("~BUN")
      ? [join(dirname(process.execPath), name)]
      : []),
    resolve(import.meta.dir, "../../dist-runner", name),
  ];
  if (!import.meta.dir.includes("$bunfs") && !import.meta.dir.includes("~BUN"))
    candidates.push(
      resolve(import.meta.dir, "../../../../.cache/engine-research/bin", name),
    );
  const path = candidates.find((p): p is string => !!p && existsSync(p));
  if (!path)
    throw new AppError(
      "HELPER_UNAVAILABLE",
      "Act Dock's native helper is missing. Reinstall the app or build the development helper.",
    );
  return path;
}
export async function nativeHelper<T = unknown>(
  request: Record<string, unknown>,
  timeout = 15000,
): Promise<T> {
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > 8 * 1024 * 1024)
    throw new AppError(
      "HELPER_INPUT_LIMIT",
      "The operation exceeds the helper input limit.",
    );
  return new Promise<T>((resolve, reject) => {
    const child = spawn(helperPath(), [], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let output = "",
      settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value as T);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(
        new AppError(
          String(request.op).startsWith("vault_")
            ? "VAULT_UNAVAILABLE"
            : "HELPER_TIMEOUT",
          String(request.op).startsWith("vault_")
            ? "The system vault did not respond without interaction. Open it and authorize the updated helper or replace the saved secret, then retry."
            : "The native operation timed out. Check the system vault or network, then retry.",
        ),
      );
    }, timeout);
    child.once("error", () =>
      finish(
        new AppError(
          "HELPER_UNAVAILABLE",
          "The native helper could not start.",
        ),
      ),
    );
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (Buffer.byteLength(output) > 8 * 1024 * 1024) {
        child.kill();
        finish(
          new AppError(
            "HELPER_OUTPUT_LIMIT",
            "The native operation returned too much data.",
          ),
        );
      }
    });
    child.once("close", () => {
      try {
        const result = JSON.parse(output) as {
          ok: boolean;
          code?: string;
          value: T;
        };
        if (!result.ok) {
          const code = /^[A-Z_]{1,64}$/.test(result.code || "")
            ? result.code!
            : "HELPER_ERROR";
          const message =
            code === "VAULT_LOCKED"
              ? "Unlock your system vault, then retry. Background runs cannot open an unlock prompt."
              : code === "VAULT_UNAVAILABLE"
                ? "The system vault is unavailable. Open Keychain, Credential Manager, or a Linux Secret Service; secrets files remain supported."
                : code === "SECRET_NOT_FOUND"
                  ? "A selected saved secret was not found. Replace it in project settings."
                  : "The native operation failed. Check the selected configuration and dependencies, then retry.";
          finish(new AppError(code, message));
        } else finish(undefined, result.value);
      } catch {
        finish(
          new AppError(
            "HELPER_PROTOCOL",
            "The native helper returned an invalid response.",
          ),
        );
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
