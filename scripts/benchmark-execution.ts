/** Controlled persistent-runner comparison; run alone after image preparation. */
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../apps/desktop/src/runner/store";
import { Scheduler } from "../apps/desktop/src/runner/scheduler";
const root = resolve(import.meta.dir, ".."),
  baseline = join(root, ".cache/optimization-baseline");
try {
  await symlink(
    join(root, "node_modules"),
    join(baseline, "node_modules"),
    "dir",
  );
} catch {}
try {
  await symlink(
    join(root, "apps/desktop/node_modules"),
    join(baseline, "apps/desktop/node_modules"),
    "dir",
  );
} catch {}
const { Store: OldStore } = await import(
  join(baseline, "apps/desktop/src/runner/store.ts")
);
const { Scheduler: OldScheduler } = await import(
  join(baseline, "apps/desktop/src/runner/process.ts")
);
const dir =
    process.env.ACT_DOCK_BENCH_RESUME_DIR ||
    (await mkdtemp(join(tmpdir(), "ad-persistent-benchmark-"))),
  project = join(dir, "project");
await mkdir(join(project, ".github/workflows"), { recursive: true });
await writeFile(
  join(project, ".github/workflows/minimal.yml"),
  `name: Persistent benchmark\non: push\njobs:\n  bench:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo benchmark-success\n`,
);
const init = Bun.spawn(["git", "init", "-q", project]);
if ((await init.exited) !== 0) throw new Error("git init failed");
const setups: Record<string, { store: Store; scheduler: Scheduler }> = {};
for (const name of ["baseline", "optimized"]) {
  const data = join(dir, name);
  await mkdir(join(data, "logs"), { recursive: true });
  const store = name === "baseline" ? new OldStore(data) : new Store(data);
  store.saveSettings({
    ...store.settings(),
    actPath: join(root, ".cache/engine-research/bin/act"),
  });
  store.putProject({ id: "p", name: "Benchmark", path: project, defaults: {} });
  setups[name] = {
    store,
    scheduler:
      name === "baseline" ? new OldScheduler(store) : new Scheduler(store),
  };
}
const samples: Record<string, unknown>[] = process.env.ACT_DOCK_BENCH_RESUME_LOG
  ? (await Bun.file(process.env.ACT_DOCK_BENCH_RESUME_LOG).text())
      .split("\n")
      .flatMap((line) => {
        try {
          const value = JSON.parse(line);
          return ["baseline", "optimized"].includes(value.name) &&
            Number.isInteger(value.batch)
            ? [value]
            : [];
        } catch {
          return [];
        }
      })
  : [];
const resumedSamples = samples.length;
const completed = new Set(
  samples.map((row) => `${row.batch}:${row.repetition}:${row.name}`),
);
const revisionProcess = Bun.spawn(["git", "rev-parse", "HEAD"], {
  cwd: root,
  stdout: "pipe",
  stderr: "ignore",
});
const optimizedSource = (
  await new Response(revisionProcess.stdout).text()
).trim();
if (await revisionProcess.exited)
  throw new Error("Cannot identify the benchmark source revision");
async function trial(name: string, batch: number, repetition: number) {
  if (batch >= 0 && completed.has(`${batch}:${repetition}:${name}`)) return;
  const { store, scheduler } = setups[name];
  const before = process.cpuUsage(),
    started = performance.now();
  const run = scheduler.enqueue(
    {
      projectId: "p",
      workflowPath: ".github/workflows/minimal.yml",
      event: "push",
      inputs: {},
      architecture: "linux/amd64",
    },
    "cli",
  );
  while (
    ["queued", "running", "cancelling"].includes(store.run(run.id).state)
  ) {
    if (performance.now() - started > 120000) throw new Error("run timeout");
    await Bun.sleep(5);
  }
  const elapsedMs = performance.now() - started,
    cpu = process.cpuUsage(before),
    result = store.run(run.id);
  if (result.state !== "succeeded") throw new Error(JSON.stringify(result));
  const logs = await scheduler.logs(run.id, 0, 1000);
  if (
    !logs.entries.some((entry: { message: string }) =>
      entry.message.includes("benchmark-success"),
    )
  )
    throw new Error("output mismatch");
  const first = logs.entries.find((entry: { message: string }) =>
    /Run Main/.test(entry.message),
  );
  if (batch >= 0) {
    samples.push({
      name,
      batch,
      repetition,
      elapsedMs,
      hostCpuMs: (cpu.user + cpu.system) / 1000,
      firstStepMs: first
        ? Date.parse(first.time) - Date.parse(run.createdAt)
        : null,
      records: logs.entries.length,
    });
    console.log(JSON.stringify(samples.at(-1)));
    await Bun.write(
      join(dir, "checkpoint.json"),
      JSON.stringify({ samples }, null, 2),
    );
  }
  while (scheduler.busy) await Bun.sleep(5);
}
try {
  await trial("baseline", -1, 0);
  await trial("optimized", -1, 0);
  for (let batch = 0; batch < 2; batch++)
    for (let repetition = 0; repetition < 20; repetition++)
      for (const name of (batch + repetition) % 2
        ? ["optimized", "baseline"]
        : ["baseline", "optimized"])
        await trial(name, batch, repetition);
} finally {
  for (const { store, scheduler } of Object.values(setups)) {
    await scheduler.stop();
    store.close();
  }
  await writeFile(
    join(
      root,
      "docs/research/act-engine/optimization/persistent-benchmark.json",
    ),
    JSON.stringify(
      {
        time: new Date().toISOString(),
        platform: process.platform,
        arch: process.arch,
        baseline: "b71aad8",
        optimizedSource,
        resumedAfterInterruption: !!process.env.ACT_DOCK_BENCH_RESUME_LOG,
        resumedSamples,
        act: "0.2.89",
        fixture:
          "single command, same workflow/project/image content, Linux AMD64",
        notes:
          "Host CPU is the Bun process, not Docker/Act children; two interleaved batches, 20 repetitions per variant per batch. Warm cache, separate disposable persistent stores. No speed claim for cold image pulls.",
        complete: samples.length === 80,
        samples,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Benchmark state:", dir);
}
