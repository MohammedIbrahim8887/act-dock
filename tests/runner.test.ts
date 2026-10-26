import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  chmod,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/runner/store";
import { Scheduler } from "../src/runner/process";
import {
  discover,
  canonicalProject,
  validateRun,
  commandArgs,
} from "../src/runner/workflows";
import {
  runRequestSchema,
  type Project,
  type RunRequest,
} from "../src/shared/contracts";
let dir: string, store: Store, scheduler: Scheduler, project: Project;
const workflow = `name: Checks\non:\n  push:\n  workflow_dispatch:\n    inputs:\n      flavor:\n        type: choice\n        required: true\n        options: [fast, slow]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hello\n`;
const request = (): RunRequest =>
  runRequestSchema.parse({
    projectId: project.id,
    workflowPath: ".github/workflows/ci.yml",
    event: "push",
  });
async function waitFor(fn: () => boolean, ms = 5000) {
  const until = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > until) throw new Error("Timed out");
    await Bun.sleep(20);
  }
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ad-"));
  await mkdir(join(dir, "logs"));
  await mkdir(join(dir, ".github/workflows"), { recursive: true });
  await writeFile(join(dir, ".github/workflows/ci.yml"), workflow);
  const fakeAct = join(dir, "act"),
    fakeDocker = join(dir, "docker");
  await writeFile(
    fakeAct,
    `#!${process.execPath}\nif(process.argv.includes('--version')){console.log('act fake');process.exit(0);}\nconst input=process.argv.join(' ');\nprocess.stdout.write('{"msg":"hel');await Bun.sleep(25);process.stdout.write('lo","jobID":"test"}\\n');console.error('stderr line');\nif(input.includes('slow=true'))await Bun.sleep(30000);\nawait Bun.sleep(80);if(input.includes('fail=true'))process.exit(7);\n`,
  );
  await writeFile(
    fakeDocker,
    `#!${process.execPath}\nif(process.argv.includes('info'))console.log('fake docker');\n`,
  );
  await chmod(fakeAct, 0o700);
  await chmod(fakeDocker, 0o700);
  store = new Store(dir);
  store.saveSettings({
    ...store.settings(),
    actPath: fakeAct,
    dockerPath: fakeDocker,
  });
  project = store.putProject({
    id: "p",
    path: dir,
    name: "Fixture",
    defaults: {},
  });
  scheduler = new Scheduler(store);
});
afterEach(async () => {
  await scheduler.stop();
  store.close();
  await rm(dir, { recursive: true, force: true });
});
describe("workflows", () => {
  test("discovers manual inputs, jobs and malformed files independently", async () => {
    await writeFile(join(dir, ".github/workflows/bad.yaml"), "jobs: [broken");
    const all = await discover(project);
    expect(all).toHaveLength(2);
    expect(all.find((w) => w.name === "Checks")?.inputs[0].options).toEqual([
      "fast",
      "slow",
    ]);
    expect(
      all.find((w) => w.path.endsWith("bad.yaml"))?.diagnostic,
    ).toBeTruthy();
  });
  test("canonicalizes symlinks and rejects relative project paths", async () => {
    await symlink(dir, join(dir, "alias"));
    expect(await canonicalProject(join(dir, "alias"))).toBe(
      await canonicalProject(dir),
    );
    await expect(canonicalProject("relative")).rejects.toThrow("absolute");
  });
  test("blocks symlink workflow escapes and unknown jobs", async () => {
    await writeFile(join(dir, "outside.yml"), workflow);
    await symlink(
      join(dir, "outside.yml"),
      join(dir, ".github/workflows/escape.yml"),
    );
    await expect(
      validateRun(project, {
        ...request(),
        workflowPath: ".github/workflows/escape.yml",
      }),
    ).rejects.toThrow("inside");
    await expect(
      validateRun(project, { ...request(), jobId: "nope" }),
    ).rejects.toThrow("no longer");
  });
  test("validates required choice inputs and unsupported runners", async () => {
    await expect(
      validateRun(project, { ...request(), event: "workflow_dispatch" }),
    ).rejects.toThrow("required");
    await expect(
      validateRun(project, {
        ...request(),
        event: "workflow_dispatch",
        inputs: { flavor: "bad" },
      }),
    ).rejects.toThrow("valid value");
    await writeFile(
      join(dir, ".github/workflows/ci.yml"),
      workflow.replace("ubuntu-latest", "macos-latest"),
    );
    await expect(validateRun(project, request())).rejects.toThrow(
      "standard Ubuntu",
    );
  });
  test("uses argument arrays and explicit runner mapping without interpolating shell input", () => {
    const args = commandArgs(
      project,
      { ...request(), inputs: { name: "$(touch /tmp/never)" } },
      "abc",
    );
    expect(args).toContain("name=$(touch /tmp/never)");
    expect(args).toContain("--label act-dock.run=abc");
    expect(args).toContain("--insecure-secrets=false");
    expect(args).toContain("ubuntu-latest=catthehacker/ubuntu:act-latest");
  });
});
describe("scheduler", () => {
  test("runs FIFO, preserves split output and stderr, resumes log cursors", async () => {
    const a = scheduler.enqueue(request(), "cli"),
      b = scheduler.enqueue(
        { ...request(), inputs: { second: "true" } },
        "mcp",
      );
    await waitFor(() => store.run(b.id).state === "succeeded");
    expect(store.run(a.id).finishedAt! <= store.run(b.id).startedAt!).toBe(
      true,
    );
    const first = await scheduler.logs(a.id, 0, 1);
    expect(first.entries[0].message).toBe("hello");
    const rest = await scheduler.logs(a.id, first.nextCursor, 100);
    expect(rest.entries.some((l) => l.message === "stderr line")).toBe(true);
    expect(rest.entries.every((l) => l.cursor > first.nextCursor)).toBe(true);
    expect(rest.end).toBe(true);
  });
  test("deduplicates idempotent requests and rejects different payloads", () => {
    const r = { ...request(), idempotencyKey: "once" };
    const a = scheduler.enqueue(r, "cli");
    expect(scheduler.enqueue(r, "mcp").id).toBe(a.id);
    expect(() =>
      scheduler.enqueue({ ...r, event: "workflow_dispatch" }, "mcp"),
    ).toThrow("different request");
  });
  test("cancels queued runs and protects busy projects", async () => {
    scheduler.stopping = true;
    expect(() => scheduler.enqueue(request(), "cli")).toThrow("stopping");
    scheduler.stopping = false;
    const a = scheduler.enqueue(request(), "cli");
    expect(() => store.removeProject(project.id)).toThrow("Cancel");
    expect(scheduler.cancel(a.id).state).toBe("cancelled");
  });
  test("cancels the active process group", async () => {
    const a = scheduler.enqueue(
      { ...request(), inputs: { slow: "true" } },
      "cli",
    );
    await waitFor(() => store.run(a.id).state === "running");
    scheduler.cancel(a.id);
    await waitFor(() => store.run(a.id).state === "cancelled");
  });
  test("records nonzero exits and missing executables", async () => {
    const a = scheduler.enqueue(
      { ...request(), inputs: { fail: "true" } },
      "cli",
    );
    await waitFor(() => store.run(a.id).state === "failed");
    expect(store.run(a.id).exitCode).toBe(7);
    store.saveSettings({ ...store.settings(), actPath: "/does/not/exist" });
    const b = scheduler.enqueue(request(), "cli");
    await waitFor(() => store.run(b.id).state === "failed");
    expect(store.run(b.id).diagnostic).toContain("not found");
  });
});
describe("persistence", () => {
  test("recovers active work as interrupted and preserves queued work", () => {
    const a = scheduler.enqueue(request(), "cli");
    store.putRun({ ...a, state: "running" });
    const b = scheduler.enqueue(
      { ...request(), inputs: { queued: "true" } },
      "cli",
    );
    const second = new Store(dir);
    expect(second.run(a.id).state).toBe("interrupted");
    expect(second.run(b.id).state).toBe("queued");
    expect(
      (second.db.query("PRAGMA user_version").get() as { user_version: number })
        .user_version,
    ).toBe(2);
    second.close();
  });
  test("prunes expired completed runs but preserves active runs", () => {
    const a = scheduler.enqueue(request(), "cli");
    const b = scheduler.enqueue(
      { ...request(), inputs: { old: "true" } },
      "cli",
    );
    store.putRun({
      ...b,
      state: "succeeded",
      finishedAt: "2020-01-01T00:00:00Z",
    });
    store.prune();
    expect(() => store.run(b.id)).toThrow("expired");
    expect(store.run(a.id).state).toBe("queued");
  });
});

test("idempotency ignores input key ordering and log pagination stays bounded", async () => {
  const a = scheduler.enqueue(
    { ...request(), inputs: { a: "1", b: "2" }, idempotencyKey: "ordered" },
    "cli",
  );
  expect(
    scheduler.enqueue(
      { ...request(), inputs: { b: "2", a: "1" }, idempotencyKey: "ordered" },
      "cli",
    ).id,
  ).toBe(a.id);
  for (let i = 0; i < 50; i++) scheduler.log(a.id, "x".repeat(65536));
  const first = await scheduler.logs(a.id, 0, 2000);
  expect(first.entries.length).toBeLessThan(50);
  expect(first.nextCursor).toBeGreaterThan(0);
  const second = await scheduler.logs(a.id, first.nextCursor, 2000);
  expect(second.entries[0].cursor).toBe(first.nextCursor + 1);
  scheduler.cancel(a.id);
});
