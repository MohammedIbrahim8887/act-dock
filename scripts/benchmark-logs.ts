import { mkdtemp, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../apps/desktop/src/runner/store";
import { LogWriter } from "../apps/desktop/src/runner/log-writer";
import { readEvents } from "../apps/desktop/src/runner/events";
const root = resolve(import.meta.dir, ".."),
  { Store: OldStore } = await import(
    join(root, ".cache/optimization-baseline/apps/desktop/src/runner/store.ts")
  ),
  { Scheduler: OldScheduler } = await import(
    join(
      root,
      ".cache/optimization-baseline/apps/desktop/src/runner/process.ts",
    )
  );
const dir = await mkdtemp(join(tmpdir(), "ad-log-benchmark-"));
const samples: Record<string, unknown>[] = [];
for (let repetition = 0; repetition < 20; repetition++)
  for (const name of repetition % 2
    ? ["optimized", "baseline"]
    : ["baseline", "optimized"]) {
    const path = join(dir, name + repetition);
    await mkdir(join(path, "logs"), { recursive: true });
    const store = name === "baseline" ? new OldStore(path) : new Store(path),
      writer =
        name === "baseline"
          ? new OldScheduler(store)
          : new LogWriter(store, "bench");
    const start = performance.now(),
      cpu = process.cpuUsage();
    for (let i = 1; i <= 10000; i++) {
      const text = JSON.stringify({
        msg: `burst line ${i}`,
        jobID: "job",
        raw_output: true,
      });
      if (name === "baseline") writer.log("bench", text, "stdout");
      else await writer.write(text, "stdout");
    }
    if (name === "optimized") await writer.close();
    const used = process.cpuUsage(cpu),
      elapsedMs = performance.now() - start,
      count = (
        store.db
          .query("SELECT COUNT(*) AS n FROM log_index WHERE run_id='bench'")
          .get() as { n: number }
      ).n;
    if (count !== 10000) throw new Error("Dropped log output");
    samples.push({
      name,
      repetition,
      elapsedMs,
      hostCpuMs: (used.user + used.system) / 1000,
      count,
    });
    store.close();
  }
const eventSamples: number[] = [];
const eventDir = join(dir, "events");
await mkdir(join(eventDir, "logs"), { recursive: true });
const store = new Store(eventDir),
  writer = new LogWriter(store, "events");
for (let i = 0; i < 100; i++) {
  const cursor = store.eventCursor(),
    waiting = readEvents(store, { cursor, limit: 500, waitMs: 10000 }),
    start = performance.now();
  writer.write("event " + i);
  await waiting;
  eventSamples.push(performance.now() - start);
}
await writer.close();
store.close();
await Bun.write(
  join(root, "docs/research/act-engine/optimization/log-benchmark.json"),
  JSON.stringify(
    {
      time: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      baseline: "b71aad8",
      notes:
        "20 interleaved 10,000-line bursts per implementation. Optimized includes fsync; baseline retains its original sync append and per-line index commits. Event samples include the 50ms timer and committed file/index visibility.",
      samples,
      eventSamplesMs: eventSamples,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    samples: samples.length,
    eventSamples: eventSamples.length,
    state: dir,
  }),
);
