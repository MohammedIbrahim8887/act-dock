import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/runner/store";
import { checkHealth } from "../src/runner/doctor";

let dir: string, store: Store;
const online = async () => true;
async function script(name: string, body: string) {
  const file = join(dir, name);
  await writeFile(file, `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o700);
  return file;
}
const engine = (fields: Record<string, unknown>) =>
  JSON.stringify({ ServerVersion: "29.0.0", OSType: "linux", OperatingSystem: "Docker Desktop", Architecture: "aarch64", NCPU: 8, MemTotal: 16 * 1024 ** 3, ...fields });
async function docker(info: string, infoExit = 0, image = "exit 0") {
  return script("docker", `if [ "$1" = info ]; then echo '${info}'; exit ${infoExit}; fi\nif [ "$1" = image ]; then ${image}; fi\nexit 0`);
}
async function configure(dockerPath: string) {
  const actPath = await script("act", 'echo "act version 0.2.89"');
  store.saveSettings({ ...store.settings(), dockerPath, actPath });
}
const find = (r: Awaited<ReturnType<typeof checkHealth>>, id: string) => r.checks.find((c) => c.id === id)!;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ad-health-"));
  store = new Store(dir);
});
afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

test("a missing Docker CLI blocks pipelines and points to the setting that's wrong", async () => {
  await configure(join(dir, "no-docker"));
  const r = await checkHealth(store, { reachGitHub: online });
  expect(r.overall).toBe("blocked");
  const cli = find(r, "docker-cli");
  expect(cli.status).toBe("error");
  expect(cli.action).toEqual({ kind: "view", target: "settings", label: "Fix in Settings" });
  expect(find(r, "docker-resources").status).toBe("skipped");
});

test("a stopped Docker engine blocks pipelines and offers to start it", async () => {
  await configure(await docker('{"ServerErrors":["Cannot connect to the Docker daemon. Is the docker daemon running?"]}', 1));
  const r = await checkHealth(store, { reachGitHub: online });
  expect(r.overall).toBe("blocked");
  const daemon = find(r, "docker-engine");
  expect(daemon.status).toBe("error");
  expect(daemon.summary).toBe("Docker isn’t running");
  expect(daemon.action).toMatchObject({ kind: "runner", id: "start_docker" });
  expect(find(r, "runner-image").status).toBe("skipped");
});

test("a healthy machine passes every required check and reports engine facts", async () => {
  await configure(await docker(engine({}), 0, "echo 1500000000; exit 0"));
  const r = await checkHealth(store, { reachGitHub: online });
  expect(r.overall).not.toBe("blocked");
  for (const c of r.checks.filter((c) => c.group === "required")) expect(c.status).toBe("ok");
  expect(find(r, "docker-engine").summary).toBe("Running · Docker 29.0.0");
  expect(find(r, "act").summary).toBe("v0.2.89 · custom path");
  expect(find(r, "runner-image").status).toBe("ok");
  expect(find(r, "docker-resources").summary).toBe("8 CPUs · 16 GB memory");
});

test("low Docker memory, a missing job image, and no GitHub access are suggestions, not blockers", async () => {
  await configure(await docker(engine({ MemTotal: 2 * 1024 ** 3 }), 0, "exit 1"));
  const r = await checkHealth(store, { reachGitHub: async () => false });
  expect(r.overall).toBe("attention");
  expect(find(r, "docker-resources").status).toBe("warning");
  expect(find(r, "runner-image")).toMatchObject({ status: "warning", action: { kind: "runner", id: "pull_image" } });
  expect(find(r, "network").status).toBe("warning");
});

test("Windows containers are reported as blocking, with the switch to make", async () => {
  await configure(await docker(engine({ OSType: "windows" })));
  const r = await checkHealth(store, { reachGitHub: online });
  expect(r.overall).toBe("blocked");
  expect(find(r, "docker-engine").summary).toBe("Docker is using Windows containers");
});
