import { beforeEach, afterEach, test, expect } from "bun:test";
import {
  mkdtemp,
  mkdir,
  rm,
  appendFile,
  readFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/runner/store";
import { LogWriter, normalizeLog } from "../src/runner/log-writer";
import { readEvents } from "../src/runner/events";
import { Images } from "../src/runner/images";
import { Secrets, parseDotenv, dotenvText } from "../src/runner/secrets";
import { Caches } from "../src/runner/caches";
import { runRequestSchema } from "../src/shared/contracts";
let dir: string, store: Store;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ad-optimized-"));
  await mkdir(join(dir, "logs"));
  store = new Store(dir);
  store.putProject({ id: "p", name: "Fixture", path: dir, defaults: {} });
});
afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});
function run() {
  const r = {
    id: crypto.randomUUID(),
    request: runRequestSchema.parse({
      projectId: "p",
      workflowPath: ".github/workflows/ci.yml",
      event: "push",
    }),
    projectName: "Fixture",
    projectPath: dir,
    source: "cli" as const,
    state: "queued" as const,
    createdAt: new Date().toISOString(),
    command: ["act"],
  };
  store.putRun(r);
  return r;
}
test("10,000 log records retain order and committed cursors; uncommitted tails recover", async () => {
  const r = run(),
    writer = new LogWriter(store, r.id);
  for (let i = 1; i <= 10000; i++) await writer.write(`line ${i}`);
  await writer.close();
  const index = store.db
    .query(
      "SELECT cursor,offset,length FROM log_index WHERE run_id=? ORDER BY cursor",
    )
    .all(r.id) as { cursor: number; offset: number; length: number }[];
  expect(index).toHaveLength(10000);
  const text = await readFile(join(dir, "logs", r.id + ".jsonl"), "utf8"),
    lines = text
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
  expect(lines.map((l) => l.cursor)).toEqual(
    Array.from({ length: 10000 }, (_, i) => i + 1),
  );
  expect(lines.at(-1).message).toBe("line 10000");
  for (const row of index)
    expect(
      Buffer.from(text)
        .subarray(row.offset, row.offset + row.length)
        .toString()
        .endsWith("\n"),
    ).toBe(true);
  await appendFile(join(dir, "logs", r.id + ".jsonl"), '{"partial":');
  const recovered = new Store(dir);
  expect((await stat(join(dir, "logs", r.id + ".jsonl"))).size).toBe(
    Buffer.byteLength(text),
  );
  recovered.close();
});
test("event pages resume without duplicates and wake on committed log batches", async () => {
  const r = run(),
    cursor = store.eventCursor(),
    waiting = readEvents(store, { cursor, limit: 500, waitMs: 10000 });
  const writer = new LogWriter(store, r.id);
  writer.write("ready");
  await writer.flush();
  const page = await waiting;
  expect(page.events.map((e) => e.kind)).toEqual(["logs"]);
  expect(page.nextCursor).toBeGreaterThan(cursor);
  expect(
    (
      await readEvents(store, {
        cursor: page.nextCursor,
        limit: 500,
        waitMs: 0,
      })
    ).events,
  ).toEqual([]);
  await writer.close();
});
test("normalization masks values and never falls back to unfiltered structured metadata", () => {
  const canary = "secret-canary-123";
  expect(
    normalizeLog(
      JSON.stringify({
        msg: `ok ${canary}`,
        metadata: canary,
        stepid: ["1"],
        stage: "Main",
      }),
      "stdout",
      [canary],
    ),
  ).toMatchObject({ message: "ok ***", stepId: ["1"], stage: "Main" });
  expect(
    JSON.stringify(normalizeLog(`{\"private\":\"${canary}`, "stdout")),
  ).not.toContain(canary);
});
test("a platform-specific local image needs no registry under if-missing", async () => {
  const images = new Images(store),
    commands: string[][] = [];
  images.environment = async () => ({});
  images.command = async (args: string[]) => {
    commands.push(args);
    if (args.includes("inspect"))
      return {
        stdout: JSON.stringify([
          { Id: "sha256:local", Os: "linux", Architecture: "amd64", Size: 42 },
        ]),
        stderr: "",
      };
    throw new Error("Registry access forbidden");
  };
  const result = await images.resolve(
    "example/runner:stable",
    "linux/amd64",
    "if-missing",
  );
  expect(result.available).toBe(true);
  expect(result.resolved).toBe("sha256:local");
  expect(
    commands.every((a) => !a.includes("pull") && !a.includes("manifest")),
  ).toBe(true);
});
test("cached-only action miss never invokes the acquisition helper", async () => {
  const caches = new Caches(store, new Images(store));
  await expect(
    caches.action(
      store.project("p"),
      "https://github.com/example/action",
      "v1",
      "cached-only",
      "",
      "r",
    ),
  ).rejects.toThrow("not cached");
  expect(caches.pending.size).toBe(0);
});
test("private one-run files preserve values and disappear on cleanup; metadata stays value-free", async () => {
  const r = run(),
    secrets = new Secrets(store),
    canary = "canary$TOKEN\\path\nsecond\tline\\";
  secrets.ephemeral.set(r.id, { TOKEN: canary });
  const prepared = await secrets.prepare(
    r.id,
    store.project("p"),
    r.request,
    [],
  );
  expect(JSON.parse(await readFile(prepared.path, "utf8")).TOKEN).toBe(canary);
  expect((await stat(prepared.path)).mode & 0o777).toBe(0o600);
  expect(JSON.stringify(store.run(r.id))).not.toContain("canary$TOKEN");
  for (const line of canary.split("\n"))
    expect(
      normalizeLog(JSON.stringify({ msg: line }), "stdout", prepared.values)
        .message,
    ).not.toContain(line);
  await secrets.cleanup(r.id);
  expect(await Bun.file(prepared.path).exists()).toBe(false);
});
test("dotenv quoting is stable for multiline, dollars, quotes and backslashes", () => {
  const values = {
    A: "hello\nworld",
    B: 'a"b',
    C: "$NAME",
    D: "C:\\path\\next",
    E: "# comment",
    F: "",
  };
  expect(parseDotenv(dotenvText(values))).toEqual(values);
});

test("bounded engine framing handles split UTF-8, split lines and oversized input", async () => {
  const { engineLines } = await import("../src/runner/lines"),
    { Readable } = await import("node:stream");
  const bytes = Buffer.from("α\nsecond\n"),
    stream = Readable.from([
      bytes.subarray(0, 1),
      bytes.subarray(1),
      Buffer.from("x".repeat(128) + "\nafter\n"),
    ]);
  const lines = [];
  for await (const line of engineLines(stream, 64)) lines.push(line);
  expect(lines.slice(0, 2)).toEqual(["α", "second"]);
  expect(lines[2]).toContain("input limit");
  expect(lines[3]).toBe("after");
});
test("restart requires resupplying queued ephemeral values without persisting them", () => {
  const r = run();
  store.putRun({
    ...r,
    ephemeralSecretNames: ["TOKEN"],
    overrideFingerprint: "private-hmac-only",
  });
  const recovered = new Store(dir);
  expect(recovered.run(r.id).needsSecretInput).toBe(true);
  expect(recovered.run(r.id).queueReason).toBe("secret-input-required");
  recovered.close();
});
test("file/index failure does not publish a log event or committed index", async () => {
  const r = run(),
    writer = new LogWriter(store, r.id),
    cursor = store.eventCursor();
  store.db.exec(
    "CREATE TRIGGER reject_logs BEFORE INSERT ON log_index BEGIN SELECT RAISE(FAIL,'injected index failure'); END;",
  );
  writer.write("must remain uncommitted");
  await expect(writer.close()).rejects.toThrow("injected index failure");
  expect(
    store.db.query("SELECT cursor FROM log_index WHERE run_id=?").all(r.id),
  ).toHaveLength(0);
  expect(
    (await readEvents(store, { cursor, limit: 500, waitMs: 0 })).events,
  ).toHaveLength(0);
  const recovered = new Store(dir);
  expect((await stat(join(dir, "logs", r.id + ".jsonl"))).size).toBe(0);
  recovered.close();
});
test("cache maintenance respects both active leases and project preparation intents", async () => {
  const caches = new Caches(store, new Images(store)),
    now = new Date().toISOString();
  caches.save({
    id: "owned",
    projectId: "p",
    kind: "npm",
    path: "volume",
    createdAt: now,
    lastUsedAt: now,
    bytes: null,
    leases: 0,
    generation: 1,
    metadata: {},
  });
  caches.projectIntents.set("run", "p");
  await expect(caches.clear("owned")).rejects.toThrow("preparing or running");
  caches.projectIntents.clear();
  const entry = caches.list()[0];
  caches.lease(entry, "run");
  await expect(caches.clear("owned")).rejects.toThrow("in use");
  caches.release("run");
  expect(caches.list()[0].leases).toBe(0);
});
test("auto architecture uses Linux Docker facts and never assumes the desktop architecture", async () => {
  const images = new Images(store);
  images.environment = async () => ({});
  images.command = async () => ({
    stdout: JSON.stringify({ OSType: "linux", Architecture: "x86_64" }),
    stderr: "",
  });
  expect(await images.platform("auto")).toBe("linux/amd64");
  expect(await images.platform("linux/arm64")).toBe("linux/arm64");
});
test("vault failures do not publish secret metadata or secret values", async () => {
  const { writeFile, chmod } = await import("node:fs/promises"),
    path = join(dir, "locked-helper");
  await writeFile(
    path,
    `#!${process.execPath}\nawait Bun.stdin.text();console.log(JSON.stringify({ok:false,code:"VAULT_LOCKED"}));\n`,
  );
  await chmod(path, 0o700);
  const previous = process.env.ACT_DOCK_HELPER_PATH;
  process.env.ACT_DOCK_HELPER_PATH = path;
  try {
    const secrets = new Secrets(store);
    await expect(
      secrets.put("p", "TOKEN", "vault-leak-canary"),
    ).rejects.toThrow("Unlock");
    expect(secrets.list("p")).toEqual([]);
    expect(
      JSON.stringify(store.db.query("SELECT data FROM secret_metadata").all()),
    ).not.toContain("vault-leak-canary");
  } finally {
    if (previous) process.env.ACT_DOCK_HELPER_PATH = previous;
    else delete process.env.ACT_DOCK_HELPER_PATH;
  }
});

test("cached-only source guard blocks fetches despite wildcard proxy bypasses", async () => {
  const { actionSourceGuard } = await import(
      "../src/runner/executor/action-network"
    ),
    { request } = await import("node:http");
  const guard = await actionSourceGuard({ NO_PROXY: "*,BLOCKED.INVALID" }, [
    "blocked.invalid",
  ]);
  const proxy = new URL(guard.environment.HTTP_PROXY);
  try {
    const code = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          hostname: proxy.hostname,
          port: proxy.port,
          path: "http://blocked.invalid/owner/repo/info/refs",
          headers: {
            "proxy-authorization": `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}`,
          },
          method: "GET",
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode!));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(code).toBe(403);
    expect(guard.environment.NO_PROXY).not.toContain("*");
    expect(guard.environment.NO_PROXY).not.toContain("blocked.invalid");
  } finally {
    await guard.close();
  }
});
test("cached-only guard forwards unrelated traffic and strips proxy credentials", async () => {
  const { actionSourceGuard } = await import(
      "../src/runner/executor/action-network"
    ),
    { createServer, request } = await import("node:http");
  let leaked = false;
  const target = createServer((req, res) => {
    leaked = !!req.headers["proxy-authorization"];
    res.end("allowed");
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  const port = (target.address() as { port: number }).port,
    guard = await actionSourceGuard({}, ["blocked.invalid"]),
    proxy = new URL(guard.environment.HTTP_PROXY);
  try {
    const text = await new Promise<string>((resolve, reject) => {
      const req = request(
        {
          hostname: proxy.hostname,
          port: proxy.port,
          path: `http://127.0.0.1:${port}/`,
          headers: {
            "proxy-authorization": `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}`,
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve(body));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(text).toBe("allowed");
    expect(leaked).toBe(false);
  } finally {
    await guard.close();
    await new Promise<void>((resolve) => target.close(() => resolve()));
  }
});
test("selected Docker contexts become explicit immutable run endpoints", async () => {
  const { writeFile, chmod } = await import("node:fs/promises"),
    { engineEnvironment } = await import("../src/runner/executor/act");
  const cli = join(dir, "docker-context");
  await writeFile(
    cli,
    `#!${process.execPath}\nif(process.argv.includes('inspect'))console.log(JSON.stringify([{Endpoints:{docker:{Host:'tcp://127.0.0.1:2376',SkipTLSVerify:false}},TLSMaterial:{docker:['ca.pem']},Storage:{TLSPath:'/fixture/tls'}}]));else console.log('fixture-context');\n`,
  );
  await chmod(cli, 0o700);
  store.saveSettings({ ...store.settings(), dockerPath: cli });
  const previous = process.env.DOCKER_CONTEXT;
  process.env.DOCKER_CONTEXT = "fixture-context";
  try {
    const environment = await engineEnvironment(store);
    expect(environment.DOCKER_HOST).toBe("tcp://127.0.0.1:2376");
    expect(environment.DOCKER_CONTEXT).toBeUndefined();
    expect(environment.DOCKER_CERT_PATH).toBe("/fixture/tls/docker");
    const scoped = new Images(store).scoped(environment);
    store.saveSettings({
      ...store.settings(),
      dockerPath: "/another/context/docker",
    });
    expect(scoped.docker()).toBe(cli);
  } finally {
    if (previous) process.env.DOCKER_CONTEXT = previous;
    else delete process.env.DOCKER_CONTEXT;
  }
});

test("Docker context failures are recoverable and do not poison successful checks", async () => {
  const { writeFile, chmod } = await import("node:fs/promises"),
    { engineEnvironment } = await import("../src/runner/executor/act");
  const cli = join(dir, "docker-context-failure");
  const previous = process.env.DOCKER_CONTEXT;
  process.env.DOCKER_CONTEXT = "fixture";
  await writeFile(cli, `#!${process.execPath}\nprocess.exit(23);\n`);
  await chmod(cli, 0o700);
  store.saveSettings({ ...store.settings(), dockerPath: cli });
  try {
    await expect(engineEnvironment(store)).rejects.toMatchObject({
      code: "DOCKER_UNAVAILABLE",
    });
    await writeFile(
      cli,
      `#!${process.execPath}\nconsole.log(JSON.stringify([{Endpoints:{docker:{Host:'unix:///fixture-recovered'}}}]));\n`,
    );
    expect((await engineEnvironment(store)).DOCKER_HOST).toBe(
      "unix:///fixture-recovered",
    );
  } finally {
    if (previous) process.env.DOCKER_CONTEXT = previous;
    else delete process.env.DOCKER_CONTEXT;
  }
});

test("dotenv imports preserve an existing configured map and write exact private YAML values", async () => {
  const { writeFile, chmod } = await import("node:fs/promises");
  const original = process.env.ACT_DOCK_HELPER_PATH;
  const helper = join(dir, "import-helper");
  await writeFile(
    helper,
    `#!${process.execPath}\nawait Bun.stdin.text();console.log(JSON.stringify({ok:true,value:{KEEP:'replacement',NEW:'tab\\tvalue\\\\'}}));\n`,
  );
  await chmod(helper, 0o700);
  process.env.ACT_DOCK_HELPER_PATH = helper;
  const source = join(dir, "incoming.env"),
    existing = join(dir, "existing.yaml");
  await writeFile(source, "KEEP=replacement\nNEW=fixture\n");
  await writeFile(existing, JSON.stringify({ KEEP: "original" }));
  store.putProject({ ...store.project("p"), defaults: { envFile: existing } });
  const secrets = new Secrets(store);
  try {
    expect(await secrets.preview("p", source, "env")).toEqual({
      names: ["KEEP", "NEW"],
      duplicates: ["KEEP"],
    });
    await secrets.import("p", source, "env", ["KEEP", "NEW"], false);
    const destination = store.project("p").defaults.envFile!;
    expect(destination.endsWith(".yaml")).toBe(true);
    expect(JSON.parse(await readFile(destination, "utf8"))).toEqual({
      KEEP: "original",
      NEW: "tab\tvalue\\",
    });
    expect((await stat(destination)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(existing, "utf8"))).toEqual({
      KEEP: "original",
    });
  } finally {
    if (original) process.env.ACT_DOCK_HELPER_PATH = original;
    else delete process.env.ACT_DOCK_HELPER_PATH;
  }
});
