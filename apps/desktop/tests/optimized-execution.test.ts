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
    canary = "canary$TOKEN\\path\nsecond line";
  secrets.ephemeral.set(r.id, { TOKEN: canary });
  const prepared = await secrets.prepare(
    r.id,
    store.project("p"),
    r.request,
    [],
  );
  expect(parseDotenv(await readFile(prepared.path, "utf8")).TOKEN).toBe(canary);
  expect((await stat(prepared.path)).mode & 0o777).toBe(0o600);
  expect(JSON.stringify(store.run(r.id))).not.toContain(canary);
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
