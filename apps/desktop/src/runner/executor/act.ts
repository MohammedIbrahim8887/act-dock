import { APP_VERSION } from "../../shared/version";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join, delimiter, dirname } from "node:path";
import type { Health } from "../../shared/contracts";
import type { Store } from "../store";
import { executablePath, bundledActPath } from "../paths";
export const exec = promisify(execFile);
export function executionEnvironment(dockerPath?: string): NodeJS.ProcessEnv {
  const dirs = [
    dockerPath && dirname(dockerPath),
    "/Applications/Docker.app/Contents/Resources/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH,
  ].filter(Boolean);
  return { ...process.env, PATH: dirs.join(delimiter) };
}
// A path chosen in Settings wins, then the act engine shipped with the app, then the system.
export function binary(name: string, configured = "", bundled = "") {
  if (configured) return existsSync(configured) ? configured : undefined;
  if (bundled && existsSync(bundled)) return bundled;
  return (
    Bun.which(name) ||
    ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
      .map((p) => join(p, name))
      .find(existsSync)
  );
}
const healthCache = new WeakMap<
  Store,
  { key: string; until: number; pending: Promise<Health> }
>();
export function invalidateHealth(store: Store) {
  healthCache.delete(store);
}
export function health(store: Store): Promise<Health> {
  const key = JSON.stringify([
    store.settings().actPath,
    store.settings().dockerPath,
  ]);
  const prior = healthCache.get(store);
  if (prior && prior.key === key && prior.until > Date.now())
    return prior.pending;
  const pending = inspectHealth(store);
  const entry = { key, until: Date.now() + 5000, pending };
  healthCache.set(store, entry);
  void pending.then(
    (result) => {
      if (!result.act.ok || !result.docker.ok) healthCache.delete(store);
    },
    () => healthCache.delete(store),
  );
  return pending;
}
async function inspectHealth(store: Store): Promise<Health> {
  const s = store.settings();
  async function check(
    name: string,
    args: string[],
    custom: string,
    bundled = "",
  ) {
    const path = binary(name, custom, bundled);
    if (!path)
      return {
        ok: false,
        message: custom
          ? `${name} was not found at the path chosen in Settings.`
          : name === "act"
            ? "The act engine was not found. Reinstall Act Dock or choose an act executable in Settings."
            : `${name} was not found. Install it or choose its executable in Settings.`,
      };
    try {
      const r = await exec(path, args, {
        timeout: 5000,
        env: executionEnvironment(),
        maxBuffer: 1024 * 1024,
      });
      const version = r.stdout.trim();
      return {
        path,
        ok: true,
        message: path === bundled ? `${version} (bundled)` : version,
      };
    } catch {
      return {
        path,
        ok: false,
        message:
          name === "docker"
            ? "Docker is unavailable. Start Docker Desktop, then retry."
            : "act could not start. Check its executable in Settings.",
      };
    }
  }
  const [act, docker] = await Promise.all([
    check("act", ["--version"], s.actPath, bundledActPath),
    check("docker", ["info", "--format", "{{.ServerVersion}}"], s.dockerPath),
  ]);
  return { act, docker, version: APP_VERSION, executable: executablePath };
}
