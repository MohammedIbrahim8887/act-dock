import { APP_VERSION } from "../shared/version";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, appendFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import {
  AppError,
  activeStates,
  type Health,
  type LogPage,
  type Run,
  type RunRequest,
} from "../shared/contracts";
import { Store } from "./store";
import { commandArgs, validateRun } from "./workflows";
import { executablePath } from "./paths";
const exec = promisify(execFile);
export function binary(name: string, configured = "") {
  if (configured) return existsSync(configured) ? configured : undefined;
  return (
    Bun.which(name) ||
    ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
      .map((p) => join(p, name))
      .find(existsSync)
  );
}
export async function health(store: Store): Promise<Health> {
  const s = store.settings();
  async function check(name: string, args: string[], custom: string) {
    const path = binary(name, custom);
    if (!path)
      return {
        ok: false,
        message: `${name} was not found. Install it or choose its executable in Settings.`,
      };
    try {
      const r = await exec(path, args, {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      });
      return { path, ok: true, message: r.stdout.trim() };
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
    check("act", ["--version"], s.actPath),
    check("docker", ["info", "--format", "{{.ServerVersion}}"], s.dockerPath),
  ]);
  return { act, docker, version: APP_VERSION, executable: executablePath };
}
export class Scheduler {
  busy = false;
  stopping = false;
  current?: {
    id: string;
    child: ReturnType<typeof spawn>;
    timer?: ReturnType<typeof setTimeout>;
  };
  constructor(public store: Store) {}
  enqueue(request: RunRequest, source: Run["source"]) {
    if (this.stopping)
      throw new AppError(
        "RUNNER_STOPPING",
        "The runner is stopping. Start it again before submitting runs.",
      );
    return this.store.db.transaction(() => {
      if (request.idempotencyKey) {
        const prev = this.store.idempotent(request.idempotencyKey);
        if (prev) {
          if (
            JSON.stringify({
              ...prev.request,
              idempotencyKey: undefined,
              inputs: Object.fromEntries(
                Object.entries(prev.request.inputs).sort(),
              ),
            }) !==
            JSON.stringify({
              ...request,
              idempotencyKey: undefined,
              inputs: Object.fromEntries(Object.entries(request.inputs).sort()),
            })
          )
            throw new AppError(
              "IDEMPOTENCY_CONFLICT",
              "This idempotency key belongs to a different request.",
            );
          return prev;
        }
      }
      const p = this.store.project(request.projectId);
      const id = crypto.randomUUID();
      const r: Run = {
        id,
        request,
        projectName: p.name,
        projectPath: p.path,
        source,
        state: "queued",
        createdAt: new Date().toISOString(),
        command: ["act", ...commandArgs(p, request, id)],
      };
      this.store.putRun(r);
      queueMicrotask(() => void this.pump());
      return r;
    })();
  }
  log(id: string, message: string, stream = "system") {
    // Act masks declared secrets. Also remove terminal control sequences and cap pathological lines.
    const clean = message
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .slice(0, 65536);
    const row = this.store.db
      .query(
        "SELECT COALESCE(MAX(cursor),0) AS n FROM log_index WHERE run_id=?",
      )
      .get(id) as { n: number };
    const cursor = row.n + 1;
    let job: string | undefined,
      level: string | undefined,
      text = clean;
    try {
      const d = JSON.parse(clean);
      text = String(d.msg ?? d.message ?? clean);
      job = d.jobID || d.job ? String(d.jobID || d.job) : undefined;
      level = d.level ? String(d.level) : undefined;
    } catch {}
    const entry = {
      cursor,
      time: new Date().toISOString(),
      stream,
      message: text,
      job,
      level,
    };
    const line = JSON.stringify(entry) + "\n";
    const file = join(this.store.directory, "logs", id + ".jsonl");
    const offset =
      (
        this.store.db
          .query(
            "SELECT offset+length AS n FROM log_index WHERE run_id=? ORDER BY cursor DESC LIMIT 1",
          )
          .get(id) as { n: number } | null
      )?.n || 0;
    appendFileSync(file, line, { mode: 0o600 });
    this.store.db
      .query("INSERT INTO log_index VALUES (?,?,?,?)")
      .run(id, cursor, offset, Buffer.byteLength(line));
  }
  async logs(id: string, cursor: number, limit: number): Promise<LogPage> {
    const run = this.store.run(id);
    let rows = this.store.db
      .query(
        "SELECT cursor, offset, length FROM log_index WHERE run_id=? AND cursor>? ORDER BY cursor LIMIT ?",
      )
      .all(id, cursor, limit) as {
      cursor: number;
      offset: number;
      length: number;
    }[];
    let bytes = 0;
    rows = rows.filter((row) => {
      bytes += row.length;
      return bytes <= 2 * 1024 * 1024;
    });
    if (!rows.length)
      return {
        entries: [],
        nextCursor: cursor,
        end: !activeStates.includes(run.state),
      };
    const first = rows[0],
      last = rows[rows.length - 1];
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
        .query("SELECT MAX(cursor) AS n FROM log_index WHERE run_id=?")
        .get(id) as { n: number }
    ).n;
    return {
      entries,
      nextCursor: last.cursor,
      end: !activeStates.includes(run.state) && last.cursor >= max,
    };
  }
  cancel(id: string) {
    const r = this.store.run(id);
    if (!activeStates.includes(r.state)) return r;
    if (r.state === "queued")
      return this.store.putRun({
        ...r,
        state: "cancelled",
        finishedAt: new Date().toISOString(),
      });
    const run = this.store.putRun({ ...r, state: "cancelling" });
    if (this.current?.id === id) {
      this.signal(this.current.child.pid, "SIGTERM");
      if (!this.current.timer)
        this.current.timer = setTimeout(
          () => this.signal(this.current?.child.pid, "SIGKILL"),
          5000,
        );
    }
    return run;
  }
  signal(pid: number | undefined, signal: NodeJS.Signals) {
    if (pid)
      try {
        process.kill(-pid, signal);
      } catch {}
  }
  async cleanup(id: string) {
    const docker = binary("docker", this.store.settings().dockerPath);
    if (!docker) return;
    try {
      const { stdout } = await exec(
        docker,
        ["ps", "-aq", "--filter", `label=act-dock.run=${id}`],
        { timeout: 5000 },
      );
      const ids = stdout
        .trim()
        .split(/\s+/)
        .filter((x) => /^[a-f0-9]+$/.test(x));
      if (ids.length)
        await exec(docker, ["rm", "-f", ...ids], { timeout: 10000 });
    } catch (e) {
      this.log(
        id,
        "Container cleanup could not complete. Check Docker for containers labeled act-dock.run=" +
          id,
      );
    }
  }
  async pump() {
    if (this.busy || this.stopping) return;
    this.busy = true;
    try {
      while (!this.stopping) {
        const run = this.store
          .runs()
          .filter((r) => r.state === "queued")
          .reverse()[0];
        if (!run) break;
        await this.execute(run);
        this.store.prune();
      }
    } finally {
      this.busy = false;
    }
  }
  async execute(run: Run) {
    let spawned = false;
    try {
      const p = this.store.project(run.request.projectId);
      await validateRun(p, run.request);
      const h = await health(this.store);
      if (!h.act.ok) throw new AppError("ACT_UNAVAILABLE", h.act.message);
      if (!h.docker.ok)
        throw new AppError("DOCKER_UNAVAILABLE", h.docker.message);
      if (this.store.run(run.id).state !== "queued") return;
      const args = commandArgs(p, run.request, run.id);
      this.store.putRun({
        ...run,
        state: "running",
        startedAt: new Date().toISOString(),
        command: [h.act.path!, ...args],
      });
      const dockerDir = h.docker.path ? resolve(h.docker.path, "..") : "";
      const child = spawn(h.act.path!, args, {
        cwd: p.path,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: [dockerDir, process.env.PATH].filter(Boolean).join(":"),
        },
      });
      spawned = true;
      this.current = { id: run.id, child };
      const completion = new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => resolve(code ?? 1));
      });
      async function drain(
        s: NodeJS.ReadableStream | null,
        write: (line: string) => void,
      ) {
        if (!s) return;
        const lines = createInterface({ input: s, crlfDelay: Infinity });
        for await (const line of lines) write(line);
      }
      const [exitCode] = await Promise.all([
        completion,
        drain(child.stdout, (line) => this.log(run.id, line, "stdout")),
        drain(child.stderr, (line) => this.log(run.id, line, "stderr")),
      ]);
      const latest = this.store.run(run.id);
      this.store.putRun({
        ...latest,
        state:
          latest.state === "cancelling"
            ? "cancelled"
            : exitCode === 0
              ? "succeeded"
              : "failed",
        exitCode,
        finishedAt: new Date().toISOString(),
      });
    } catch (e) {
      const latest = this.store.run(run.id);
      if (latest.state !== "cancelled") {
        const message = e instanceof Error ? e.message : String(e);
        this.log(run.id, message);
        this.store.putRun({
          ...latest,
          state: latest.state === "cancelling" ? "cancelled" : "failed",
          diagnostic: message,
          finishedAt: new Date().toISOString(),
        });
      }
    } finally {
      if (this.current?.timer) clearTimeout(this.current.timer);
      if (spawned) await this.cleanup(run.id);
      this.current = undefined;
    }
  }
  async stop() {
    this.stopping = true;
    for (const r of this.store.runs())
      if (activeStates.includes(r.state)) this.cancel(r.id);
    while (this.busy) await Bun.sleep(50);
  }
}
