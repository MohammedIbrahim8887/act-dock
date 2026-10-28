/** Explicit destructive fault injection, scoped to disposable runner stores and labelled fixture resources. */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../apps/desktop/src/runner/store";
import { Scheduler } from "../apps/desktop/src/runner/scheduler";
import {
  runRequestSchema,
  type Run,
} from "../apps/desktop/src/shared/contracts";
const root = resolve(import.meta.dir, "..");
async function wait(check: () => boolean | Promise<boolean>, timeout = 90000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end)
      throw new Error("Timed out waiting for fixture condition");
    await Bun.sleep(100);
  }
}
const results: { check: string; passed: boolean; detail?: unknown }[] = [];
function assert(check: string, passed: boolean, detail?: unknown) {
  results.push({ check, passed, detail });
  console.log(JSON.stringify(results.at(-1)));
  if (!passed) throw new Error(check);
}
const dir =
  process.env.ACT_DOCK_RECOVERY_CHILD ||
  (await mkdtemp(join(tmpdir(), "ad-recovery-")));
await mkdir(join(dir, "logs"), { recursive: true });
const store = new Store(dir);
const scheduler = new Scheduler(store);
const nonce = crypto.randomUUID().slice(0, 8);
async function project(id: string, name: string, jobs: string) {
  const path = join(dir, id);
  await mkdir(join(path, ".github/workflows"), { recursive: true });
  await writeFile(
    join(path, ".github/workflows/ci.yml"),
    `name: ${name}-${nonce}\non: push\njobs:\n${jobs}\n`,
  );
  const git = Bun.spawn(["git", "init", "-q", path]);
  if (await git.exited) throw new Error("git init");
  store.putProject({ id, path, name: id, defaults: {} });
}
function submit(id: string, execution: Record<string, unknown> = {}) {
  return scheduler.enqueue(
    runRequestSchema.parse({
      projectId: id,
      workflowPath: ".github/workflows/ci.yml",
      event: "push",
      architecture: "linux/amd64",
      execution,
    }),
    "cli",
  );
}
async function finish(run: Run) {
  await wait(
    () =>
      !["queued", "running", "cancelling"].includes(store.run(run.id).state),
  );
  return store.run(run.id);
}
const act = join(root, ".cache/engine-research/bin/act");
store.saveSettings({
  ...store.settings(),
  actPath: act,
  concurrency: { enabled: true, maxWorkflows: 2 },
});
if (process.env.ACT_DOCK_RECOVERY_CHILD) {
  await project(
    "crash",
    "Crash recovery",
    `  work:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo crash-fixture-started; sleep 60`,
  );
  const run = submit("crash");
  await wait(
    async () =>
      store.run(run.id).phase === "executing" &&
      (await scheduler.logs(run.id, 0, 1000)).entries.some((e) =>
        e.message.includes("crash-fixture-started"),
      ) &&
      store.db
        .query(
          "SELECT id FROM resources WHERE run_id=? AND json_extract(data,'$.kind')='container'",
        )
        .all(run.id).length > 0,
  );
  await Bun.write(join(dir, "ready.json"), JSON.stringify({ runId: run.id }));
  await new Promise(() => {});
} else
  try {
    await project(
      "matrix-a",
      "Matrix collision",
      `  test:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        n: [1,2]\n    steps:\n      - run: echo matrix-fixture; sleep 2`,
    );
    await project(
      "matrix-b",
      "Matrix collision",
      await Bun.file(join(dir, "matrix-a/.github/workflows/ci.yml"))
        .text()
        .then((s) => s.split("jobs:\n")[1]),
    );
    const a = submit("matrix-a"),
      b = submit("matrix-b");
    await wait(() => store.run(b.id).queueReason === "container-namespace");
    assert("matrix namespaces serialize across projects", true);
    const both = await Promise.all([finish(a), finish(b)]);
    assert(
      "matrix runs retain results",
      both.every((run) => run.state === "succeeded"),
      both.map((r) => r.diagnostic),
    );
    await project(
      "service",
      "Service cancellation",
      `  test:\n    runs-on: ubuntu-latest\n    services:\n      database:\n        image: postgres:17-alpine\n        env:\n          POSTGRES_HOST_AUTH_METHOD: trust\n    steps:\n      - run: echo service-fixture-started; sleep 60`,
    );
    const service = submit("service");
    await wait(async () => {
      const r = store.run(service.id);
      if (!["queued", "running", "cancelling"].includes(r.state))
        throw new Error(JSON.stringify(r));
      return (await scheduler.logs(service.id, 0, 1000)).entries.some((e) =>
        e.message.includes("service-fixture-started"),
      );
    });
    await wait(
      () =>
        store.db
          .query(
            "SELECT id FROM resources WHERE run_id=? AND json_extract(data,'$.kind') IN ('service-container','container')",
          )
          .all(service.id).length >= 2,
    );
    scheduler.cancel(service.id);
    const cancelled = await finish(service);
    assert(
      "service cancellation completes owned cleanup",
      cancelled.state === "cancelled" &&
        store.db
          .query("SELECT id FROM resources WHERE run_id=?")
          .all(service.id).length === 0,
      cancelled.diagnostic,
    );
    await project(
      "budget-a",
      "Budget A",
      `  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: sleep 3`,
    );
    await project(
      "budget-b",
      "Budget B",
      `  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo budget-fixture`,
    );
    const facts = JSON.parse(
        (await scheduler.images.command(["info", "--format", "{{json .}}"]))
          .stdout,
      ),
      memoryBudget = (facts.MemTotal / 1024 ** 3) * 0.75;
    const held = submit("budget-a"),
      waiting = submit("budget-b", {
        reservation: { cpus: 2, memoryGiB: Math.max(1, memoryBudget - 0.5) },
      });
    await wait(() => store.run(waiting.id).queueReason === "resource-budget");
    assert("resource reservations queue excess admission", true);
    await finish(held);
    assert(
      "released reservations admit queued work",
      (await finish(waiting)).state === "succeeded",
    );
    await scheduler.stop();
    store.close();
    const crashDir = await mkdtemp(join(tmpdir(), "ad-crash-"));
    const child = Bun.spawn([process.execPath, import.meta.path], {
      env: { ...process.env, ACT_DOCK_RECOVERY_CHILD: crashDir },
      stdout: "ignore",
      stderr: "pipe",
    });
    try {
      await wait(async () => {
        if (child.exitCode !== null)
          throw new Error(await new Response(child.stderr).text());
        return await Bun.file(join(crashDir, "ready.json")).exists();
      });
      const { runId } = await Bun.file(join(crashDir, "ready.json")).json();
      child.kill("SIGKILL");
      await child.exited;
      const recovered = new Store(crashDir),
        recoverer = new Scheduler(recovered);
      await recoverer.ready;
      assert(
        "runner crash marks active work interrupted",
        recovered.run(runId).state === "interrupted",
      );
      assert(
        "crash reconciliation clears proven owned resources",
        recovered.db.query("SELECT id FROM resources WHERE run_id=?").all(runId)
          .length === 0,
        recovered.run(runId).diagnostic,
      );
      await recoverer.stop();
      recovered.close();
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  } finally {
    if (!store.closed) {
      await scheduler.stop();
      store.close();
    }
    await Bun.write(
      join(
        root,
        "docs/research/act-engine/optimization/recovery-acceptance.json",
      ),
      JSON.stringify(
        {
          time: new Date().toISOString(),
          platform: process.platform,
          arch: process.arch,
          results,
        },
        null,
        2,
      ) + "\n",
    );
  }
