/** Explicit real-Docker acceptance checks. Uses disposable projects/data, never the user's runner. */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { Store } from "../apps/desktop/src/runner/store";
import { Scheduler } from "../apps/desktop/src/runner/scheduler";
import {
  runRequestSchema,
  type Run,
} from "../apps/desktop/src/shared/contracts";
const root = resolve(import.meta.dir, ".."),
  dir = await mkdtemp(join(tmpdir(), "act-dock-acceptance-"));
await mkdir(join(dir, "logs"));
const fixtureNamespace = crypto.randomUUID().slice(0, 8);
const store = new Store(dir);
store.saveSettings({
  ...store.settings(),
  actPath:
    process.env.ACT_DOCK_TEST_ACT ||
    join(root, ".cache/engine-research/bin/act"),
  concurrency: { enabled: true, maxWorkflows: 2 },
});
const scheduler = new Scheduler(store),
  results: { check: string; passed: boolean; detail?: unknown }[] = [];
function assert(check: string, passed: boolean, detail?: unknown) {
  results.push({ check, passed, detail });
  console.log(JSON.stringify(results.at(-1)));
  if (!passed) throw new Error(check);
}
async function project(
  id: string,
  name: string,
  steps = "      - run: echo started; sleep 3; echo finished",
) {
  const path = join(dir, id);
  await mkdir(join(path, ".github/workflows"), { recursive: true });
  await writeFile(
    join(path, ".github/workflows/ci.yml"),
    `name: ${name}-${fixtureNamespace}\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n${steps}\n`,
  );
  await new Promise<void>((ok, bad) => {
    const p = Bun.spawn(["git", "init", "-q", path], {
      stdout: "ignore",
      stderr: "ignore",
    });
    void p.exited.then((n) => (n ? bad(new Error("git init")) : ok()));
  });
  store.putProject({ id, path, name: id, defaults: {} });
  return id;
}
function submit(projectId: string, execution: Record<string, unknown> = {}) {
  return scheduler.enqueue(
    runRequestSchema.parse({
      projectId,
      workflowPath: ".github/workflows/ci.yml",
      event: "push",
      architecture: "linux/amd64",
      execution: { imagePullPolicy: "if-missing", ...execution },
    }),
    "cli",
  );
}
async function wait(predicate: () => boolean, timeout = 120000) {
  const until = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > until)
      throw new Error(
        "Timed out: " +
          JSON.stringify(
            store.runs().map((r) => ({
              id: r.id,
              state: r.state,
              reason: r.queueReason,
              diagnostic: r.diagnostic,
            })),
          ),
      );
    await Bun.sleep(30);
  }
}
async function finished(run: Run) {
  await wait(
    () =>
      !["queued", "running", "cancelling"].includes(store.run(run.id).state),
  );
  return store.run(run.id);
}
try {
  await project("a", "Independent Alpha");
  await project("b", "Independent Beta");
  const a = submit("a"),
    b = submit("b");
  await wait(() => scheduler.active.size === 2);
  assert("independent workflows admitted together", true);
  const [ar, br] = await Promise.all([finished(a), finished(b)]);
  assert(
    "independent workflows succeed",
    ar.state === "succeeded" && br.state === "succeeded",
    [ar.diagnostic, br.diagnostic],
  );
  const ae = (await scheduler.logs(a.id, 0, 1000)).entries,
    be = (await scheduler.logs(b.id, 0, 1000)).entries;
  const times = (entries: typeof ae) =>
    entries.filter((e) => e.rawOutput).map((e) => Date.parse(e.time));
  assert(
    "real step execution overlaps",
    Math.max(Math.min(...times(ae)), Math.min(...times(be))) <
      Math.min(Math.max(...times(ae)), Math.max(...times(be))),
  );
  const first = submit("a"),
    second = submit("a");
  await wait(() => store.run(second.id).queueReason === "workspace-busy");
  assert(
    "same project serializes",
    store.run(second.id).queueReason === "workspace-busy",
  );
  await Promise.all([finished(first), finished(second)]);
  await project("c", "Colliding");
  await project("d", "Colliding");
  const c = submit("c"),
    d = submit("d");
  await wait(() => store.run(d.id).queueReason === "container-namespace");
  assert(
    "same Act namespace serializes across projects",
    store.run(d.id).queueReason === "container-namespace",
  );
  await Promise.all([finished(c), finished(d)]);
  const cancel = submit("a"),
    survivor = submit("b");
  await wait(
    () =>
      scheduler.active.size === 2 && store.run(cancel.id).phase === "executing",
  );
  scheduler.cancel(cancel.id);
  const [cr, sr] = await Promise.all([finished(cancel), finished(survivor)]);
  assert(
    "cancellation isolates one active run",
    cr.state === "cancelled" && sr.state === "succeeded",
  );
  await project(
    "action",
    "Cached action",
    `      - uses: actions/setup-node@v4\n      - run: node --version`,
  );
  const cold = await finished(
    submit("action", { actionCachePolicy: "refresh" }),
  );
  assert(
    "real action snapshot acquired",
    cold.state === "succeeded",
    cold.diagnostic,
  );
  const actionBefore = JSON.stringify(
    scheduler.caches.list("action").map((c) => c.metadata),
  );
  const previous = process.env.ACT_DOCK_HELPER_PATH;
  process.env.ACT_DOCK_HELPER_PATH = "/definitely-missing";
  const warm = await finished(
    submit("action", { actionCachePolicy: "cached-only" }),
  );
  if (previous) process.env.ACT_DOCK_HELPER_PATH = previous;
  else delete process.env.ACT_DOCK_HELPER_PATH;
  assert(
    "cached-only action executes",
    warm.state === "succeeded",
    warm.diagnostic,
  );
  assert(
    "cached-only does not refresh acquisition metadata",
    actionBefore ===
      JSON.stringify(scheduler.caches.list("action").map((c) => c.metadata)),
  );
  assert(
    "cached-only does not delegate remote action fetches",
    !(await scheduler.logs(warm.id, 0, 1000)).entries.some((e) =>
      /GoGitActionCache fetch|git clone/.test(e.message),
    ),
  );
  await project(
    "packages",
    "Package downloads",
    `      - run: npm cache add is-number@7.0.0 --prefer-offline; npm cache ls | grep is-number`,
  );
  const packageCold = await finished(
    submit("packages", { packageCaches: ["npm"] }),
  );
  assert(
    "npm download volume works",
    packageCold.state === "succeeded",
    packageCold.diagnostic,
  );
  const packageProject = store.project("packages");
  await writeFile(
    join(packageProject.path, ".github/workflows/ci.yml"),
    `name: Package downloads-${fixtureNamespace}\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm cache add is-number@7.0.0 --offline; npm cache ls | grep is-number\n`,
  );
  const packageWarm = await finished(
    submit("packages", { packageCaches: ["npm"] }),
  );
  assert(
    "warm npm cache works with npm offline",
    packageWarm.state === "succeeded",
    packageWarm.diagnostic,
  );
  const secretValue = crypto.randomUUID() + '\tquoted"value\nsecond-line\\';
  const expectedHash = createHash("sha256").update(secretValue).digest("hex");
  await project(
    "secret-wire",
    "Exact secret values",
    `      - run: |\n          test "$(printf '%s' "$EXACT_VALUE" | sha256sum | cut -d' ' -f1)" = '${expectedHash}'\n          printf '%s\\n' "$EXACT_VALUE"\n          echo exact-secret-preserved\n        env:\n          EXACT_VALUE: \${{ secrets.EXACT_VALUE }}`,
  );
  const secretRun = scheduler.enqueue(
    runRequestSchema.parse({
      projectId: "secret-wire",
      workflowPath: ".github/workflows/ci.yml",
      event: "push",
      architecture: "linux/amd64",
    }),
    "cli",
    { EXACT_VALUE: secretValue },
  );
  const exact = await finished(secretRun);
  assert(
    "official Act preserves tabs, quotes, multiline values and trailing backslashes",
    exact.state === "succeeded",
    exact.diagnostic,
  );
  assert(
    "secret values stay out of history, logs and durable events",
    ![
      JSON.stringify(store.run(secretRun.id)),
      JSON.stringify(await scheduler.logs(secretRun.id, 0, 1000)),
      JSON.stringify(store.db.query("SELECT data FROM events").all()),
    ].some((text) => text.includes(secretValue.split("\t")[0])),
  );
  await project(
    "native-auto",
    "Native Docker architecture",
    `      - run: echo native-auto-fixture`,
  );
  const auto = scheduler.enqueue(
    runRequestSchema.parse({
      projectId: "native-auto",
      workflowPath: ".github/workflows/ci.yml",
      event: "push",
      architecture: "auto",
    }),
    "cli",
  );
  const autoResult = await finished(auto),
    nativePlatform = await scheduler.images.platform("auto");
  assert(
    "Auto uses the daemon platform consistently for image and Act arguments",
    autoResult.state === "succeeded" &&
      !!autoResult.snapshot?.images.every(
        (image) => image.platform === nativePlatform,
      ) &&
      autoResult.command[
        autoResult.command.lastIndexOf("--container-architecture") + 1
      ] === nativePlatform,
    autoResult.diagnostic,
  );
  const resources = (
    await scheduler.images.command([
      "ps",
      "-aq",
      "--filter",
      `label=act-dock.run`,
    ])
  ).stdout.trim();
  assert(
    "fixture runs leave no recorded owned containers",
    store.db.query("SELECT id FROM resources").all().length === 0,
    { anyLabeledContainers: !!resources },
  );
} finally {
  await scheduler.stop();
  await mkdir(join(root, "docs/research/act-engine/optimization"), {
    recursive: true,
  });
  await writeFile(
    join(root, "docs/research/act-engine/optimization/docker-acceptance.json"),
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
  store.close();
  console.log("Acceptance data:", dir);
}
