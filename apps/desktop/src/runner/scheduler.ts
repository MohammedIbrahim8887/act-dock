import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  AppError,
  activeStates,
  runRequestSchema,
  type LogPage,
  type Run,
  type RunRequest,
} from "../shared/contracts";
import { Store } from "./store";
import { LogWriter } from "./log-writer";
import { commandArgs } from "./workflows";
import { health, exec, executionEnvironment } from "./executor/act";
import { Images } from "./images";
import { Secrets } from "./secrets";
import { Caches } from "./caches";
import { preflightRun, compatibleAct } from "./preflight";
import { resolveExecution, actrcPaths, managedActrc } from "./execution-config";
import { analyzeWorkflow } from "./workflow-analysis";

type Active = {
  id: string;
  projectPath: string;
  namespace: string[];
  exclusive: boolean;
  toolcache: boolean;
  reservation: { cpus: number; memoryGiB: number };
  child?: ReturnType<typeof spawn>;
  timer?: ReturnType<typeof setTimeout>;
  done?: Promise<void>;
};
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([k]) => k !== "idempotencyKey")
            .sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
export class Scheduler {
  stopping = false;
  pumping = false;
  active = new Map<string, Active>();
  writers = new Map<string, LogWriter>();
  retry?: ReturnType<typeof setTimeout>;
  images: Images;
  secrets: Secrets;
  caches: Caches;
  ready: Promise<void>;
  get busy() {
    return this.pumping || this.active.size > 0;
  }
  get current() {
    return [...this.active.values()][0];
  }
  constructor(public store: Store) {
    this.images = new Images(store);
    this.secrets = new Secrets(store);
    this.caches = new Caches(store, this.images);
    this.ready = this.secrets.recover().then(async () => {
      this.caches.recover();
      const orphanRuns = new Set([
        ...store
          .runs()
          .filter((r) => r.state === "interrupted")
          .map((r) => r.id),
        ...(
          store.db.query("SELECT run_id FROM resources").all() as {
            run_id: string;
          }[]
        ).map((r) => r.run_id),
      ]);
      for (const id of orphanRuns) await this.cleanup(id);
    });
  }
  enqueue(
    input: RunRequest,
    source: Run["source"],
    overrides?: Record<string, string>,
    fingerprint?: string,
  ) {
    if (this.stopping)
      throw new AppError(
        "RUNNER_STOPPING",
        "The runner is stopping. Start it again before submitting runs.",
      );
    const request = runRequestSchema.parse(input);
    return this.store.db.transaction(() => {
      if (request.idempotencyKey) {
        const previous = this.store.idempotent(request.idempotencyKey);
        if (previous) {
          if (
            canonical(previous.request) !== canonical(request) ||
            previous.overrideFingerprint !== fingerprint
          )
            throw new AppError(
              "IDEMPOTENCY_CONFLICT",
              "This idempotency key belongs to a different request.",
            );
          return previous;
        }
      }
      const project = this.store.project(request.projectId),
        id = crypto.randomUUID();
      const snapshot = resolveExecution(
        project,
        request,
        this.store.settings(),
      );
      const run: Run = {
        id,
        request,
        projectName: project.name,
        projectPath: project.path,
        source,
        state: "queued",
        createdAt: new Date().toISOString(),
        command: ["act", ...commandArgs(project, request, id)],
        snapshot,
      };
      if (overrides && Object.keys(overrides).length) {
        this.secrets.ephemeral.set(id, { ...overrides });
        run.overrideFingerprint = fingerprint;
        run.ephemeralSecretNames = Object.keys(overrides);
      }
      this.store.putRun(run);
      queueMicrotask(() => void this.pump());
      return run;
    })();
  }
  writer(id: string) {
    let writer = this.writers.get(id);
    if (!writer) {
      writer = new LogWriter(this.store, id);
      this.writers.set(id, writer);
    }
    return writer;
  }
  log(id: string, message: string, stream = "system") {
    return this.writer(id).write(message, stream);
  }
  async logs(id: string, cursor: number, limit: number): Promise<LogPage> {
    await this.writers.get(id)?.flush();
    const run = this.store.run(id);
    const rows = this.store.db
      .query(
        "SELECT cursor,offset,length FROM log_index WHERE run_id=? AND cursor>? ORDER BY cursor LIMIT ?",
      )
      .all(id, cursor, limit) as {
      cursor: number;
      offset: number;
      length: number;
    }[];
    let size = 0;
    const selected = rows.filter((r) => {
      size += r.length;
      return size <= 2 * 1024 * 1024;
    });
    if (!selected.length)
      return {
        entries: [],
        nextCursor: cursor,
        end: !activeStates.includes(run.state),
      };
    const first = selected[0],
      last = selected.at(-1)!;
    const text = await Bun.file(
      join(this.store.directory, "logs", id + ".jsonl"),
    )
      .slice(first.offset, last.offset + last.length)
      .text();
    const entries = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const max = (
      this.store.db
        .query(
          "SELECT COALESCE(MAX(cursor),0) AS n FROM log_index WHERE run_id=?",
        )
        .get(id) as { n: number }
    ).n;
    return {
      entries,
      nextCursor: last.cursor,
      end: !activeStates.includes(run.state) && last.cursor >= max,
    };
  }
  defer(run: Run, reason: string) {
    if (run.queueReason !== reason)
      this.store.putRun({ ...run, queueReason: reason });
  }
  async pump() {
    if (this.pumping || this.stopping) return;
    this.pumping = true;
    try {
      await this.ready;
      const settings = this.store.settings(),
        limit = settings.concurrency?.enabled
          ? settings.concurrency.maxWorkflows
          : 1;
      for (const run of this.store
        .runs()
        .filter((r) => r.state === "queued")
        .reverse()) {
        if (this.stopping) break;
        if (this.active.size >= limit) {
          this.defer(run, "workflow-limit");
          continue;
        }
        if (run.needsSecretInput) {
          this.defer(run, "secret-input-required");
          continue;
        }
        if (this.active.has(run.id)) continue;
        if (
          this.store.db
            .query(
              "SELECT id FROM resources WHERE run_id NOT IN (SELECT id FROM runs WHERE json_extract(data,'$.state') IN ('running','cancelling')) LIMIT 1",
            )
            .get()
        ) {
          this.defer(run, "cleanup-required");
          continue;
        }
        try {
          const project = this.store.project(run.request.projectId),
            analysis = await analyzeWorkflow(project, run.request);
          const snapshot =
            run.snapshot || resolveExecution(project, run.request, settings);
          const candidates = [...this.active.values()];
          const conflict = candidates.find(
            (a) =>
              a.projectPath === project.path ||
              a.exclusive ||
              analysis.exclusive ||
              a.namespace.some((n) => analysis.namespace.includes(n)) ||
              (a.toolcache && analysis.toolcache),
          );
          if (conflict) {
            this.defer(
              run,
              conflict.projectPath === project.path
                ? "workspace-busy"
                : analysis.toolcache && conflict.toolcache
                  ? "shared-tool-cache"
                  : "container-namespace",
            );
            continue;
          }
          if (limit > 1) {
            const { stdout } = await this.images.command(
              ["info", "--format", "{{json .}}"],
              5000,
            );
            const info = JSON.parse(stdout),
              cpu =
                candidates.reduce((s, a) => s + a.reservation.cpus, 0) +
                snapshot.options.reservation.cpus,
              mem =
                candidates.reduce((s, a) => s + a.reservation.memoryGiB, 0) +
                snapshot.options.reservation.memoryGiB;
            if (
              cpu > Number(info.NCPU) * 0.75 ||
              mem * 1024 ** 3 > Number(info.MemTotal) * 0.75
            ) {
              this.defer(run, "resource-budget");
              continue;
            }
          }
          const report = await preflightRun(
            this.store,
            this.images,
            run.request,
            snapshot,
          );
          await this.secrets.selected(
            project.id,
            report.snapshot.options.secretNames,
          );
          const blocking = report.issues.filter((i) => i.severity === "error");
          if (blocking.length) {
            const recoverable = blocking.every((i) => i.recoverable);
            if (recoverable) {
              this.defer(run, blocking[0].code);
              continue;
            }
            throw new AppError(blocking[0].code, blocking[0].message);
          }
          if (compatibleAct(report.snapshot.engine?.version || "")) {
            const existing = (
              await this.images.command(
                ["container", "ls", "-a", "--format", "{{json .}}"],
                5000,
              )
            ).stdout
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line)) as { Names?: string }[];
            const volumes = (
              await this.images.command(
                ["volume", "ls", "--format", "{{.Name}}"],
                5000,
              )
            ).stdout
              .trim()
              .split("\n");
            if (
              volumes.some((name) =>
                analysis.namespace.includes(`volume:${name}`),
              )
            ) {
              this.defer(run, "pre-existing-volume");
              continue;
            }
            if (
              existing.some((container) =>
                analysis.namespace.includes(`container:${container.Names}`),
              )
            ) {
              this.defer(run, "pre-existing-container");
              continue;
            }
          }
          const active: Active = {
            id: run.id,
            projectPath: project.path,
            namespace: analysis.namespace,
            exclusive: analysis.exclusive,
            toolcache: analysis.toolcache,
            reservation: report.snapshot.options.reservation,
          };
          this.active.set(run.id, active);
          this.store.putRun({
            ...this.store.run(run.id),
            state: "running",
            phase: "preflight",
            queueReason: undefined,
            startedAt: new Date().toISOString(),
            snapshot: report.snapshot,
          });
          active.done = this.execute(this.store.run(run.id), active).finally(
            () => {
              this.active.delete(run.id);
              if (!this.stopping) queueMicrotask(() => void this.pump());
            },
          );
        } catch (error) {
          if (
            error instanceof AppError &&
            [
              "VAULT_LOCKED",
              "VAULT_UNAVAILABLE",
              "SECRET_NOT_FOUND",
              "DOCKER_UNAVAILABLE",
              "HELPER_UNAVAILABLE",
            ].includes(error.code)
          )
            this.defer(run, error.code);
          else {
            await this.log(
              run.id,
              error instanceof AppError
                ? error.message
                : "Preflight failed. Check the workflow and Docker configuration.",
            );
            await this.writer(run.id).close();
            this.store.putRun({
              ...this.store.run(run.id),
              state: "failed",
              diagnostic:
                error instanceof AppError ? error.message : "Preflight failed",
              finishedAt: new Date().toISOString(),
            });
          }
        }
      }
    } finally {
      this.pumping = false;
      if (
        !this.stopping &&
        this.store.runs().some((r) => r.state === "queued")
      ) {
        if (this.retry) clearTimeout(this.retry);
        this.retry = setTimeout(() => {
          this.retry = undefined;
          void this.pump();
        }, 5000);
      }
    }
  }
  async execute(run: Run, active: Active) {
    let exitCode: number | undefined, errorMessage: string | undefined;
    let childCompletion: Promise<number> | undefined;
    let sampleStop: undefined | (() => Promise<void>);
    try {
      const project = this.store.project(run.request.projectId),
        snapshot = run.snapshot!;
      const h = await health(this.store),
        optimized = compatibleAct(h.act.message);
      const analysis = await analyzeWorkflow(project, run.request);
      this.store.putRun({ ...this.store.run(run.id), phase: "preparing" });
      const preparedSecrets = await this.secrets.prepare(
        run.id,
        project,
        run.request,
        snapshot.options.secretNames,
      );
      this.writer(run.id).secrets = preparedSecrets.values;
      let extra: string[] = [],
        mounts: string[] = [];
      if (optimized) {
        const platform = await this.images.platform(run.request.architecture);
        for (const [label, container] of analysis.images) {
          if (container || label.includes("${{")) continue;
          const reference = snapshot.options.runnerMappings[label];
          const resolved = await this.images.resolve(
            reference,
            platform,
            snapshot.options.imagePullPolicy,
          );
          if (!resolved.available)
            throw new AppError(
              "IMAGE_MISSING",
              `Image ${reference} is not available for ${platform} under the selected pull policy.`,
            );
          snapshot.images = snapshot.images.filter(
            (i) => i.reference !== reference,
          );
          snapshot.images.push(resolved);
        }
        const raw = await readPreparedSecrets(preparedSecrets.path);
        const cache = await this.caches.prepare(
          project,
          analysis.actions,
          snapshot,
          platform,
          run.id,
          raw.GITHUB_TOKEN || "",
        );
        extra = cache.args;
        mounts = cache.mounts;
      }
      if (this.store.run(run.id).state === "cancelling")
        throw new AppError("CANCELLED", "Run cancelled during preparation.");
      const args = commandArgs(
        project,
        run.request,
        run.id,
        optimized ? snapshot : undefined,
      );
      let inheritedOptions = "";
      for (const path of actrcPaths(project.path))
        inheritedOptions =
          managedActrc(path).containerOptions || inheritedOptions;
      args.push(
        "--container-options",
        [inheritedOptions, `--label act-dock.run=${run.id}`, ...mounts]
          .filter(Boolean)
          .join(" "),
        "--secret-file",
        preparedSecrets.path,
        ...extra,
      );
      this.store.putRun({
        ...this.store.run(run.id),
        phase: "executing",
        command: [h.act.path!, ...args.map((value,index)=>args[index-1]==="--container-options"?`--label act-dock.run=${run.id} [Docker options redacted]`:value)],
        snapshot,
      });
      for (const name of active.namespace.filter((n) =>
        n.startsWith("container:"),
      ))
        this.store.db
          .query("INSERT OR IGNORE INTO resources VALUES (?,?,?)")
          .run(
            `expected:${name}`,
            run.id,
            JSON.stringify({
              kind: "expected-container",
              name: name.slice(10),
            }),
          );
      const child = spawn(h.act.path!, args, {
        cwd: project.path,
        env: executionEnvironment(h.docker.path),
        detached: true,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      active.child = child;
      if (child.pid)
        this.store.db
          .query("INSERT OR REPLACE INTO resources VALUES (?,?,?)")
          .run(
            `process:${child.pid}`,
            run.id,
            JSON.stringify({
              kind: "process",
              pid: child.pid,
              marker: preparedSecrets.path,
            }),
          );
      const completion = (childCompletion = new Promise<number>(
        (resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code) => resolve(code ?? 1));
        },
      ));
      if (this.store.run(run.id).state === "cancelling")
        this.signal(child.pid, "SIGTERM");
      sampleStop = this.monitor(run.id);
      const drain = async (
        stream: NodeJS.ReadableStream | null,
        source: string,
      ) => {
        if (!stream) return;
        for await (const line of createInterface({
          input: stream,
          crlfDelay: Infinity,
        }))
          await this.log(run.id, line, source);
      };
      [exitCode] = await Promise.all([
        completion,
        drain(child.stdout, "stdout"),
        drain(child.stderr, "stderr"),
      ]);
    } catch (error) {
      errorMessage =
        error instanceof AppError
          ? error.message
          : "Execution failed. Check the workflow output and System health.";
      await Promise.resolve(this.log(run.id, errorMessage)).catch(() => {});
    } finally {
      if (exitCode === undefined && active.child) {
        this.signal(active.child.pid, "SIGTERM");
        await Promise.race([childCompletion?.catch(() => {}), Bun.sleep(5000)]);
        if (active.child.exitCode === null)
          this.signal(active.child.pid, "SIGKILL");
      }
      if (active.timer) clearTimeout(active.timer);
      await sampleStop?.().catch(() => {});
      this.store.putRun({ ...this.store.run(run.id), phase: "cleanup" });
      const cleaned = await this.cleanup(run.id);
      if (!cleaned)
        errorMessage =
          "Container cleanup is incomplete. Check System health before starting conflicting runs.";
      this.caches.release(run.id);
      await this.secrets.cleanup(run.id).catch(() => {
        errorMessage =
          "Private secret file cleanup failed. Repair file permissions before another run.";
      });
      try {
        await this.writer(run.id).close();
      } catch {
        errorMessage =
          "Output could not be persisted completely. Check free disk space.";
      }
      const latest = this.store.run(run.id);
      this.store.putRun({
        ...latest,
        state:
          latest.state === "cancelling"
            ? "cancelled"
            : !errorMessage && exitCode === 0
              ? "succeeded"
              : "failed",
        exitCode,
        diagnostic: errorMessage,
        finishedAt: new Date().toISOString(),
        queueReason: cleaned ? undefined : "cleanup-required",
      });
      if (!this.stopping) await this.caches.maintain().catch(() => {});
      this.store.prune();
    }
  }
  monitor(runId: string) {
    const controller = new AbortController();
    let stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      inflight = Promise.resolve();
    const tick = async () => {
      try {
        const { stdout } = await this.images.command(
          ["ps", "-aq", "--filter", `label=act-dock.run=${runId}`],
          5000,
        );
        const ids = stdout
          .trim()
          .split(/\s+/)
          .filter((id) => /^[a-f0-9]{12,64}$/.test(id));
        for (const id of ids) {
          this.store.db
            .query("INSERT OR IGNORE INTO resources VALUES (?,?,?)")
            .run(id, runId, JSON.stringify({ kind: "container", id, runId }));
          try {
            const container = JSON.parse(
              (await this.images.command(["inspect", id], 5000)).stdout,
            )[0];
            if (container?.Config?.Labels?.["act-dock.run"] === runId) {
              const namespaces = this.active.get(runId)?.namespace || [];
              for (const mount of container.Mounts || [])
                if (
                  mount.Type === "volume" &&
                  namespaces.includes(`volume:${mount.Name}`)
                ) {
                  const volume = JSON.parse(
                    (
                      await this.images.command(
                        ["volume", "inspect", mount.Name],
                        5000,
                      )
                    ).stdout,
                  )[0];
                  this.store.db
                    .query("INSERT OR IGNORE INTO resources VALUES (?,?,?)")
                    .run(
                      `volume:${mount.Name}`,
                      runId,
                      JSON.stringify({
                        kind: "volume",
                        name: mount.Name,
                        createdAt: volume.CreatedAt,
                        parent: id,
                      }),
                    );
                }
            }
          } catch {}
          if (stopped) continue;
          try {
            const stats = JSON.parse(
              (
                await this.images.command(
                  ["stats", "--no-stream", "--format", "{{json .}}", id],
                  5000,
                  controller.signal,
                )
              ).stdout,
            );
            const metric = {
              runId,
              containerId: id,
              time: new Date().toISOString(),
              cpuPercent: parseFloat(stats.CPUPerc) || 0,
              memoryBytes: memoryBytes(
                String(stats.MemUsage || "")
                  .split("/")[0]
                  .trim(),
              ),
            };
            this.store.db
              .query("INSERT INTO metrics(run_id,data) VALUES (?,?)")
              .run(runId, JSON.stringify(metric));
            this.store.emit("metrics", runId, { containerId: id });
          } catch {}
        }
      } catch {}
      if (!stopped)
        timer = setTimeout(() => {
          inflight = tick();
        }, 1000);
    };
    inflight = tick();
    return async () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      await inflight;
    };
  }
  async cleanup(id: string) {
    try {
      const { stdout } = await this.images.command(
        ["ps", "-aq", "--filter", `label=act-dock.run=${id}`],
        5000,
      );
      const processes = this.store.db
        .query("SELECT id,data FROM resources WHERE run_id=?")
        .all(id) as { id: string; data: string }[];
      for (const row of processes) {
        const processInfo = JSON.parse(row.data);
        if (processInfo.kind !== "process") continue;
        if (
          processInfo.pid === this.active.get(id)?.child?.pid &&
          this.active.get(id)?.child?.exitCode !== null
        ) {
          this.store.db.query("DELETE FROM resources WHERE id=?").run(row.id);
          continue;
        }
        if (process.platform === "win32") return false;
        let command = "";
        try {
          command = (
            await exec(
              "/bin/ps",
              ["-p", String(processInfo.pid), "-o", "command="],
              { timeout: 3000 },
            )
          ).stdout;
        } catch {}
        if (command) {
          if (!command.includes(processInfo.marker)) return false;
          this.signal(processInfo.pid, "SIGTERM");
          await Bun.sleep(100);
          try {
            process.kill(processInfo.pid, 0);
            this.signal(processInfo.pid, "SIGKILL");
          } catch {}
        }
        this.store.db.query("DELETE FROM resources WHERE id=?").run(row.id);
      }
      const known = this.store.db
        .query("SELECT id,data FROM resources WHERE run_id=?")
        .all(id) as { id: string; data: string }[];
      const ids = new Set(
        [...stdout.trim().split(/\s+/), ...known.map((r) => r.id)].filter(
          (value) => /^[a-f0-9]{12,64}$/.test(value),
        ),
      );
      for (const container of ids) {
        let present = false;
        try {
          const inspected = JSON.parse(
            (await this.images.command(["inspect", container])).stdout,
          )[0];
          present = true;
          if (inspected?.Config?.Labels?.["act-dock.run"] !== id) return false;
        } catch {}
        if (present) await this.images.command(["rm", "-f", container], 10000);
        this.store.db
          .query("DELETE FROM resources WHERE id=? AND run_id=?")
          .run(container, id);
      }
      for (const resource of known) {
        const data = JSON.parse(resource.data);
        if (data.kind === "expected-container") {
          let container;
          try {
            container = JSON.parse(
              (
                await this.images.command(
                  ["container", "inspect", data.name],
                  5000,
                )
              ).stdout,
            )[0];
          } catch {}
          if (container) {
            if (container.Config?.Labels?.["act-dock.run"] !== id) return false;
            await this.images.command(["rm", "-f", container.Id], 10000);
          }
          this.store.db
            .query("DELETE FROM resources WHERE id=? AND run_id=?")
            .run(resource.id, id);
          continue;
        }
        if (data.kind !== "volume") continue;
        let volume;
        try {
          volume = JSON.parse(
            (await this.images.command(["volume", "inspect", data.name], 5000))
              .stdout,
          )[0];
        } catch {}
        if (volume) {
          if (volume.CreatedAt !== data.createdAt) return false;
          await this.images.command(["volume", "rm", data.name], 10000);
        }
        this.store.db
          .query("DELETE FROM resources WHERE id=? AND run_id=?")
          .run(resource.id, id);
      }
      this.store.emit("cleanup", id, { complete: true });
      return true;
    } catch {
      this.store.emit("cleanup", id, { complete: false });
      return false;
    }
  }
  cancel(id: string) {
    const run = this.store.run(id);
    if (!activeStates.includes(run.state)) return run;
    if (run.state === "queued") {
      void this.secrets.cleanup(id);
      return this.store.putRun({
        ...run,
        state: "cancelled",
        queueReason: undefined,
        finishedAt: new Date().toISOString(),
      });
    }
    const latest = this.store.putRun({ ...run, state: "cancelling" }),
      active = this.active.get(id);
    if (active?.child) {
      this.signal(active.child.pid, "SIGTERM");
      if (!active.timer)
        active.timer = setTimeout(
          () => this.signal(active.child?.pid, "SIGKILL"),
          5000,
        );
    }
    return latest;
  }
  signal(pid: number | undefined, signal: NodeJS.Signals) {
    if (!pid) return;
    if (process.platform === "win32") {
      void exec("taskkill.exe", [
        "/PID",
        String(pid),
        "/T",
        ...(signal === "SIGKILL" ? ["/F"] : []),
      ]).catch(() => {});
      return;
    }
    try {
      process.kill(-pid, signal);
    } catch {}
  }
  async stop() {
    this.stopping = true;
    await this.ready;
    if (this.retry) clearTimeout(this.retry);
    for (const run of this.store.runs())
      if (activeStates.includes(run.state)) this.cancel(run.id);
    while (this.pumping) await Bun.sleep(10);
    await Promise.all([...this.active.values()].map((a) => a.done));
    for (const writer of this.writers.values()) await writer.close();
  }
}
function memoryBytes(text: string) {
  const match = text.match(/^([\d.]+)\s*([KMGT]?i?B)$/i);
  if (!match) return null;
  const units: Record<string, number> = {
    B: 1,
    KB: 1000,
    MB: 1e6,
    GB: 1e9,
    TB: 1e12,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
  };
  return Number(match[1]) * units[match[2].toUpperCase()];
}
async function readPreparedSecrets(path: string) {
  const { parseDotenv } = await import("./secrets");
  return parseDotenv(await Bun.file(path).text());
}
