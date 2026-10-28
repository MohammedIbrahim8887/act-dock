import { APP_VERSION } from "../../shared/version";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join, delimiter, dirname } from "node:path";
import { AppError, type Health } from "../../shared/contracts";
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
const contextCache = new WeakMap<
  Store,
  { key: string; until: number; pending: Promise<NodeJS.ProcessEnv> }
>();
export function engineEnvironment(store: Store): Promise<NodeJS.ProcessEnv> {
  const path = binary("docker", store.settings().dockerPath),
    base = executionEnvironment(path);
  if (base.DOCKER_HOST && !base.DOCKER_CONTEXT) {
    try {
      if (new URL(base.DOCKER_HOST).password)
        throw new AppError(
          "DOCKER_ENDPOINT_CREDENTIALS",
          "Use Docker certificates or credential helpers instead of a password in the daemon URL.",
        );
    } catch (error) {
      if (error instanceof AppError) return Promise.reject(error);
    }
    return Promise.resolve(base);
  }
  const key = JSON.stringify([path, base.DOCKER_CONTEXT, base.DOCKER_CONFIG]);
  const prior = contextCache.get(store);
  if (prior && prior.key === key && prior.until > Date.now())
    return prior.pending;
  const pending = (async () => {
    if (!path) return base;
    let name = base.DOCKER_CONTEXT;
    if (!name)
      name = (
        await exec(path, ["context", "show"], {
          timeout: 3000,
          env: base,
          maxBuffer: 1024 * 1024,
        })
      ).stdout.trim();
    if (!name) return base; // Old CLI/test executables without context support.
    const context = JSON.parse(
      (
        await exec(path, ["context", "inspect", name], {
          timeout: 3000,
          env: base,
          maxBuffer: 1024 * 1024,
        })
      ).stdout,
    )[0];
    const endpoint = context?.Endpoints?.docker;
    if (!endpoint?.Host)
      throw new AppError(
        "DOCKER_UNAVAILABLE",
        "The selected Docker context has no daemon endpoint.",
      );
    try {
      if (new URL(endpoint.Host).password)
        throw new AppError(
          "DOCKER_ENDPOINT_CREDENTIALS",
          "Remove passwords from the Docker daemon URL and use Docker credential configuration.",
        );
    } catch (error) {
      if (error instanceof AppError) throw error;
    }
    const env: NodeJS.ProcessEnv = {
      ...base,
      DOCKER_HOST: String(endpoint.Host),
    };
    delete env.DOCKER_CONTEXT;
    if (context.TLSMaterial?.docker?.length) {
      env.DOCKER_CERT_PATH = join(context.Storage.TLSPath, "docker");
      env.DOCKER_TLS_VERIFY = endpoint.SkipTLSVerify ? "" : "1";
    }
    return env;
  })().catch((error) => {
    contextCache.delete(store);
    if (error instanceof AppError) throw error;
    throw new AppError(
      "DOCKER_UNAVAILABLE",
      "The selected Docker context could not be inspected. Check Docker's executable and context, then retry.",
    );
  });
  contextCache.set(store, { key, until: Date.now() + 5000, pending });
  void pending.catch(() => contextCache.delete(store));
  return pending;
}
export function restoreDockerEnvironment(
  docker: { host: string; certPath?: string; tlsVerify?: string },
  dockerPath?: string,
): NodeJS.ProcessEnv {
  const env = executionEnvironment(dockerPath);
  delete env.DOCKER_CONTEXT;
  env.DOCKER_HOST = docker.host;
  if (docker.certPath !== undefined) env.DOCKER_CERT_PATH = docker.certPath;
  if (docker.tlsVerify !== undefined) env.DOCKER_TLS_VERIFY = docker.tlsVerify;
  return env;
}
const dockerFacts = new WeakMap<
  Store,
  { key: string; until: number; pending: Promise<string> }
>();
export async function dockerInfo(
  store: Store,
  supplied?: NodeJS.ProcessEnv,
): Promise<string> {
  const environment = supplied || (await engineEnvironment(store));
  const key = JSON.stringify([
    store.settings().dockerPath,
    environment.DOCKER_HOST,
    environment.DOCKER_CONTEXT,
  ]);
  const old = dockerFacts.get(store);
  if (old && old.key === key && old.until > Date.now()) return old.pending;
  const path = binary("docker", store.settings().dockerPath);
  if (!path) return Promise.reject(new Error("Docker unavailable"));
  const pending = exec(path, ["info", "--format", "{{json .}}"], {
    timeout: 5000,
    env: environment,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  }).then((result) => result.stdout.trim());
  dockerFacts.set(store, { key, until: Date.now() + 5000, pending });
  void pending.catch(() => dockerFacts.delete(store));
  return pending;
}
const healthCache = new WeakMap<
  Store,
  { key: string; until: number; pending: Promise<Health> }
>();
export function invalidateHealth(store: Store) {
  healthCache.delete(store);
  dockerFacts.delete(store);
  contextCache.delete(store);
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
      const r =
        name === "docker"
          ? { stdout: await dockerInfo(store) }
          : await exec(path, args, {
              timeout: 5000,
              env: executionEnvironment(),
              maxBuffer: 1024 * 1024,
            });
      let version = r.stdout.trim();
      if (name === "docker")
        try {
          const facts = JSON.parse(version);
          if (facts.OSType === "windows")
            return {
              path,
              ok: false,
              message: "Switch Docker to Linux containers, then retry.",
            };
          version = facts.ServerVersion || version;
        } catch {}
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
const adapterCapabilities = new Map<string, Promise<boolean>>();
export function engineSupportsManagedExecution(path: string) {
  let pending = adapterCapabilities.get(path);
  if (!pending) {
    pending = exec(path, ["--help"], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      env: executionEnvironment(),
      windowsHide: true,
    }).then(
      ({ stdout }) =>
        [
          "--local-repository",
          "--pull",
          "--concurrent-jobs",
          "--container-options",
          "--json",
        ].every((flag) => stdout.includes(flag)),
      () => false,
    );
    adapterCapabilities.set(path, pending);
  }
  return pending;
}
