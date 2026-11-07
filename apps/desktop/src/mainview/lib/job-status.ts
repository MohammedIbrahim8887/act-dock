import type { LogEntry } from "../../shared/contracts";

export type JobStatus = "success" | "failure" | "running" | "pending";

type Execution = "running" | "success" | "failure";

type LogPageFetcher = (
  cursor: number,
) => Promise<{ entries: LogEntry[]; nextCursor: number; end: boolean }>;

/**
 * Reads every page a run has produced so far. Each call returns the full
 * accumulated log: it continues from the last cursor, so earlier pages are
 * not fetched again, and later pages are never dropped.
 */
export function createLogReader(fetchPage: LogPageFetcher) {
  let cursor = 0;
  const entries: LogEntry[] = [];
  return async (): Promise<LogEntry[]> => {
    for (;;) {
      const page = await fetchPage(cursor);
      for (const entry of page.entries) entries.push(entry);
      cursor = page.nextCursor;
      if (page.end || page.entries.length === 0) break;
    }
    return entries;
  };
}

/**
 * Derives each job's status from act's log output.
 *
 * A job is only finished when act reports the job itself ("Job succeeded" /
 * "Job failed"). Step results such as "Success - Main setup" are not job
 * results: a step can fail under continue-on-error, and a later step may still
 * be running. A matrix job has one execution per combination, so the job
 * fails if any execution failed, is running while any execution is still
 * running, and succeeds only when every started execution succeeded.
 */
export function parseJobStatusesFromLogs(
  jobs: { id: string; name: string }[],
  entries: LogEntry[],
): Record<string, JobStatus> {
  const lookup = new Map<string, string>();
  for (const j of jobs) {
    for (const key of [j.id, j.name]) {
      lookup.set(key.toLowerCase(), j.id);
      lookup.set(key.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase(), j.id);
      lookup.set(key.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase(), j.id);
    }
  }

  const findJobId = (rawName?: string): string | null => {
    if (!rawName) return null;
    const clean = rawName.trim().toLowerCase();
    // Matrix executions are labelled like "build (node 20)".
    const base = clean.replace(/\s*\([^)]*\)$/, "");
    for (const candidate of [clean, base]) {
      const id =
        lookup.get(candidate) ||
        lookup.get(candidate.replace(/[^a-zA-Z0-9]/g, "_")) ||
        lookup.get(candidate.replace(/[^a-zA-Z0-9]/g, "-"));
      if (id) return id;
    }
    return null;
  };

  // jobId -> execution label -> state
  const executions = new Map<string, Map<string, Execution>>();
  const setState = (jobId: string, label: string, state: Execution) => {
    let runs = executions.get(jobId);
    if (!runs) executions.set(jobId, (runs = new Map()));
    runs.set(label, state);
  };

  for (const entry of entries) {
    const msg = entry.message || "";
    const prefixMatch = msg.match(/^\[([^\]]+)\]\s*(.*)$/);
    const text = (prefixMatch ? prefixMatch[2] : msg).trim();
    const label = (entry.job || prefixMatch?.[1] || "").trim();

    const startMatch = text.match(/^⭐\s+Run\s+Main\s+([^\s[]+)/);
    const jobId = findJobId(label) || findJobId(startMatch?.[1]);
    if (!jobId) continue;
    const execution = label || startMatch?.[1] || jobId;

    const terminal = text.match(/(?:🏁\s+)?Job (succeeded|failed)$/);
    if (terminal) {
      setState(jobId, execution, terminal[1] === "succeeded" ? "success" : "failure");
    } else if (startMatch) {
      // A step starting never reopens an execution act has already finished.
      const current = executions.get(jobId)?.get(execution);
      if (current !== "success" && current !== "failure")
        setState(jobId, execution, "running");
    }
  }

  const result: Record<string, JobStatus> = {};
  for (const [jobId, runs] of executions) {
    const states = [...runs.values()];
    if (states.includes("failure")) result[jobId] = "failure";
    else if (states.includes("running")) result[jobId] = "running";
    else if (states.length > 0) result[jobId] = "success";
  }
  return result;
}
