import { Database } from "bun:sqlite";
import { join } from "node:path";
import { unlinkSync } from "node:fs";
import {
  activeStates,
  AppError,
  settingsSchema,
  type Project,
  type Run,
  type Settings,
  type RunFilters,
  type HistoryQuery,
  type HistoryPage,
} from "../shared/contracts";
export class Store {
  db: Database;
  constructor(public directory: string) {
    this.db = new Database(join(directory, "act-dock.sqlite"), {
      create: true,
    });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    const version = (
      this.db.query("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    if (version < 1)
      this.db.transaction(() => {
        this.db.exec(
          "CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, data TEXT NOT NULL); CREATE TABLE runs (id TEXT PRIMARY KEY, created TEXT NOT NULL, data TEXT NOT NULL, idem TEXT UNIQUE); CREATE TABLE settings (id INTEGER PRIMARY KEY, data TEXT NOT NULL); PRAGMA user_version=1;",
        );
      })();
    if (version < 2)
      this.db.transaction(() => {
        this.db.exec(
          "CREATE TABLE IF NOT EXISTS log_index (run_id TEXT NOT NULL, cursor INTEGER NOT NULL, offset INTEGER NOT NULL, length INTEGER NOT NULL, PRIMARY KEY(run_id,cursor)); PRAGMA user_version=2;",
        );
      })();
    for (const run of this.runs())
      if (run.state === "running" || run.state === "cancelling")
        this.putRun({
          ...run,
          state: "interrupted",
          finishedAt: new Date().toISOString(),
          diagnostic:
            "Runner stopped unexpectedly. Review logs before running again.",
        });
    this.prune();
  }
  projects(): Project[] {
    return (
      this.db.query("SELECT data FROM projects ORDER BY rowid").all() as {
        data: string;
      }[]
    ).map((r) => JSON.parse(r.data));
  }
  project(id: string): Project {
    const p = this.projects().find((p) => p.id === id);
    if (!p)
      throw new AppError(
        "PROJECT_NOT_FOUND",
        "Project not found. Add the folder again.",
      );
    return p;
  }
  putProject(p: Project) {
    this.db
      .query(
        "INSERT INTO projects VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(p.id, p.path, JSON.stringify(p));
    return p;
  }
  removeProject(id: string) {
    if (
      this.runs().some(
        (r) => r.request.projectId === id && activeStates.includes(r.state),
      )
    )
      throw new AppError(
        "PROJECT_BUSY",
        "Cancel queued and active runs before removing this project.",
      );
    this.db.query("DELETE FROM projects WHERE id=?").run(id);
  }
  runs(): Run[] {
    return (
      this.db
        .query("SELECT data FROM runs ORDER BY created DESC, rowid DESC")
        .all() as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  private runFilter(filters: RunFilters) {
    const terms: string[] = [];
    const bindings: (string | number)[] = [];
    for (const [key, path] of [
      ["projectId", "$.request.projectId"],
      ["state", "$.state"],
      ["source", "$.source"],
    ] as const) {
      if (filters[key]) {
        terms.push(`json_extract(data, '${path}') = ?`);
        bindings.push(filters[key]!);
      }
    }
    if (filters.since) {
      terms.push("created >= ?");
      bindings.push(filters.since);
    }
    if (filters.query?.trim()) {
      terms.push(
        "instr(lower(coalesce(json_extract(data, '$.projectName'),'') || ' ' || coalesce(json_extract(data, '$.request.workflowPath'),'') || ' ' || coalesce(json_extract(data, '$.request.jobId'),'') || ' ' || id), ?) > 0",
      );
      bindings.push(filters.query.trim().toLowerCase());
    }
    return {
      where: terms.length ? " WHERE " + terms.join(" AND ") : "",
      bindings,
    };
  }
  listRuns(filters: RunFilters, cursor: number, limit: number): Run[] {
    const { where, bindings } = this.runFilter(filters);
    return (
      this.db
        .query(
          `SELECT data FROM runs${where} ORDER BY created DESC, rowid DESC LIMIT ? OFFSET ?`,
        )
        .all(...bindings, limit, cursor) as { data: string }[]
    ).map((row) => JSON.parse(row.data));
  }
  history(query: HistoryQuery): HistoryPage {
    return this.db.transaction(() => {
      const { where, bindings } = this.runFilter(query);
      const total = (
        this.db
          .query(`SELECT count(*) AS n FROM runs${where}`)
          .get(...bindings) as { n: number }
      ).n;
      const unfilteredTotal = (
        this.db.query("SELECT count(*) AS n FROM runs").get() as { n: number }
      ).n;
      const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
      const page = Math.min(query.page, totalPages);
      const runs = this.listRuns(
        query,
        (page - 1) * query.pageSize,
        query.pageSize,
      );
      const historical = this.db
        .query(
          "SELECT json_extract(data, '$.request.projectId') AS id, json_extract(data, '$.projectName') AS name FROM runs GROUP BY json_extract(data, '$.request.projectId')",
        )
        .all() as { id: string; name: string }[];
      const projects = new Map(
        historical.map((p) => [p.id, { ...p, available: false }]),
      );
      for (const p of this.projects())
        projects.set(p.id, { id: p.id, name: p.name, available: true });
      return {
        runs,
        total,
        unfilteredTotal,
        page,
        pageSize: query.pageSize,
        totalPages,
        projects: [...projects.values()].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      };
    })();
  }
  run(id: string): Run {
    const row = this.db.query("SELECT data FROM runs WHERE id=?").get(id) as {
      data: string;
    } | null;
    if (!row)
      throw new AppError(
        "RUN_NOT_FOUND",
        "Run not found. It may have expired from history.",
      );
    return JSON.parse(row.data);
  }
  idempotent(key: string): Run | undefined {
    const row = this.db
      .query("SELECT data FROM runs WHERE idem=?")
      .get(key) as { data: string } | null;
    return row ? JSON.parse(row.data) : undefined;
  }
  putRun(r: Run) {
    this.db
      .query(
        "INSERT INTO runs VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(
        r.id,
        r.createdAt,
        JSON.stringify(r),
        r.request.idempotencyKey || null,
      );
    return r;
  }
  settings(): Settings {
    const row = this.db.query("SELECT data FROM settings WHERE id=1").get() as {
      data: string;
    } | null;
    return settingsSchema.parse(row ? JSON.parse(row.data) : {});
  }
  saveSettings(s: Settings) {
    this.db
      .query(
        "INSERT INTO settings VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(JSON.stringify(s));
    return s;
  }
  prune() {
    let completed = 0;
    const cutoff = Date.now() - 30 * 86400000;
    for (const r of this.runs())
      if (!activeStates.includes(r.state)) {
        completed++;
        if (
          completed > 200 ||
          Date.parse(r.finishedAt || r.createdAt) < cutoff
        ) {
          this.db.query("DELETE FROM runs WHERE id=?").run(r.id);
          this.db.query("DELETE FROM log_index WHERE run_id=?").run(r.id);
          try {
            unlinkSync(join(this.directory, "logs", r.id + ".jsonl"));
          } catch {}
        }
      }
  }
  close() {
    this.db.close();
  }
}
