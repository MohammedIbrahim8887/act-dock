import { open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { LogEntry } from "../shared/contracts";
import type { Store } from "./store";

export function normalizeLog(
  message: string,
  stream: string,
  secrets: readonly string[] = [],
): Omit<LogEntry, "cursor"> {
  const redact = (text: string) => {
    let value = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
    for (const secret of secrets)
      if (secret) value = value.split(secret).join("***");
    return value.slice(0, 65536);
  };
  const entry: Omit<LogEntry, "cursor"> = {
    time: new Date().toISOString(),
    stream,
    message: "",
  };
  if (message.length > 1024 * 1024) {
    entry.message = "Engine record exceeded the 1 MiB input limit.";
    return entry;
  }
  try {
    const d = JSON.parse(message);
    entry.message = redact(String(d.msg ?? d.message ?? "Engine event"));
    const job = d.jobID || d.job;
    if (job) {
      entry.job = redact(String(job)).slice(0, 256);
      const matrix =
        d.matrix && typeof d.matrix === "object"
          ? Object.entries(d.matrix).sort(([a], [b]) => a.localeCompare(b))
          : [];
      entry.jobKey = createHash("sha256")
        .update(JSON.stringify([job, d.job, matrix]))
        .digest("hex")
        .slice(0, 24);
    }
    if (
      [
        "trace",
        "debug",
        "info",
        "warning",
        "warn",
        "error",
        "fatal",
        "panic",
      ].includes(d.level)
    )
      entry.level = d.level;
    const ids = d.stepID ?? d.stepid;
    if (Array.isArray(ids))
      entry.stepId = ids
        .slice(0, 32)
        .map((id) => redact(String(id)).slice(0, 256));
    if (["Pre", "Main", "Post"].includes(d.stage)) entry.stage = d.stage;
    if (["success", "failure", "skipped"].includes(d.stepResult))
      entry.stepResult = d.stepResult;
    if (typeof d.raw_output === "boolean") entry.rawOutput = d.raw_output;
  } catch {
    entry.message = message.trimStart().startsWith("{")
      ? "Malformed structured engine record discarded."
      : redact(message);
  }
  return entry;
}

export class LogWriter {
  pending: { entry: LogEntry; line: string; length: number }[] = [];
  bytes = 0;
  writingBytes = 0;
  cursor: number;
  offset: number;
  timer?: ReturnType<typeof setTimeout>;
  writing?: Promise<void>;
  failed?: Error;
  fd?: FileHandle;
  secrets: readonly string[] = [];
  constructor(
    readonly store: Store,
    readonly runId: string,
  ) {
    const row = store.db
      .query(
        "SELECT cursor,offset+length AS offset FROM log_index WHERE run_id=? ORDER BY cursor DESC LIMIT 1",
      )
      .get(runId) as { cursor: number; offset: number } | null;
    this.cursor = row?.cursor || 0;
    this.offset = row?.offset || 0;
  }
  write(message: string, stream = "system"): Promise<void> | undefined {
    if (this.failed) return Promise.reject(this.failed);
    const entry = {
      ...normalizeLog(message, stream, this.secrets),
      cursor: ++this.cursor,
    };
    const line = JSON.stringify(entry) + "\n",
      length = Buffer.byteLength(line);
    this.pending.push({ entry, line, length });
    this.bytes += length;
    if (!this.timer)
      this.timer = setTimeout(() => {
        void this.flush().catch(() => {});
      }, 50);
    if (this.pending.length >= 256 || this.bytes >= 65536)
      void this.flush().catch(() => {});
    if (this.bytes + this.writingBytes >= 8 * 1024 * 1024) return this.flush();
  }
  flush(): Promise<void> {
    if (this.failed) return Promise.reject(this.failed);
    if (this.writing) return this.writing;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.pending.length) return Promise.resolve();
    this.writing = (async () => {
      while (this.pending.length) {
        const batch = this.pending.splice(0, 256);
        this.writingBytes = batch.reduce((total, row) => total + row.length, 0);
        this.bytes -= this.writingBytes;
        this.fd ||= await open(
          join(this.store.directory, "logs", this.runId + ".jsonl"),
          "a",
          0o600,
        );
        // Bun's Linux writeFile on an append handle can insert a sparse gap
        // between batches. Explicit writes also account for short writes.
        const buffer = Buffer.from(batch.map((r) => r.line).join(""));
        let written = 0;
        while (written < buffer.length) {
          const { bytesWritten } = await this.fd.write(
            buffer, written, buffer.length - written, null,
          );
          if (!bytesWritten) throw new Error("Log write made no progress.");
          written += bytesWritten;
        }
        await this.fd.sync();
        let offset = this.offset;
        this.store.db.transaction(() => {
          const index = this.store.db.query(
            "INSERT INTO log_index VALUES (?,?,?,?)",
          );
          for (const { entry, length } of batch) {
            index.run(this.runId, entry.cursor, offset, length);
            offset += length;
            if (
              !entry.rawOutput &&
              /Job (?:succeeded|failed)|Run Set up job/.test(entry.message)
            )
              this.store.emit("job", this.runId, {
                job: entry.job,
                jobKey: entry.jobKey,
                state: /Set up job/.test(entry.message)
                  ? "running"
                  : entry.message.includes("failed")
                    ? "failed"
                    : "succeeded",
              });
            if (
              !entry.rawOutput &&
              (entry.stepResult ||
                /⭐\s+Run|🏁|Job (?:succeeded|failed)/u.test(entry.message))
            )
              this.store.emit("step", this.runId, { entry });
          }
          this.store.emit("logs", this.runId, {
            cursor: batch.at(-1)!.entry.cursor,
          });
        })();
        this.offset = offset;
        this.writingBytes = 0;
      }
    })()
      .catch((error) => {
        this.failed =
          error instanceof Error ? error : new Error("Log persistence failed");
        throw this.failed;
      })
      .finally(() => {
        this.writing = undefined;
      });
    return this.writing;
  }
  async close() {
    try {
      await this.flush();
    } finally {
      await this.fd?.close();
      this.fd = undefined;
      this.pending = [];
      this.bytes = 0;
      this.writingBytes = 0;
      this.secrets = [];
    }
  }
}
