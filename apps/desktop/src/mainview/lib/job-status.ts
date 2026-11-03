import type { LogEntry } from "../../shared/contracts";

export type JobStatus = "success" | "failure" | "running" | "pending";

/**
 * Extracts the real-time execution status of individual workflow jobs
 * by parsing act and container logs for success/failure/start markers.
 */
export function parseJobStatusesFromLogs(
  jobs: { id: string; name: string }[],
  entries: LogEntry[],
): Record<string, JobStatus> {
  const result: Record<string, JobStatus> = {};

  const lookup = new Map<string, string>();
  for (const j of jobs) {
    lookup.set(j.id.toLowerCase(), j.id);
    lookup.set(j.name.toLowerCase(), j.id);
    lookup.set(j.id.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase(), j.id);
    lookup.set(j.name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase(), j.id);
    lookup.set(j.id.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase(), j.id);
  }

  const findJobId = (rawName?: string): string | null => {
    if (!rawName) return null;
    const clean = rawName.trim().toLowerCase();
    return (
      lookup.get(clean) ||
      lookup.get(clean.replace(/[^a-zA-Z0-9]/g, "_")) ||
      lookup.get(clean.replace(/[^a-zA-Z0-9]/g, "-")) ||
      null
    );
  };

  for (const entry of entries) {
    const msg = entry.message || "";
    const jIdFromJob = findJobId(entry.job);

    const prefixMatch = msg.match(/^\[([^\]]+)\]\s*(.*)$/);
    const prefixJobId = prefixMatch ? findJobId(prefixMatch[1]) : null;
    const text = prefixMatch ? prefixMatch[2] : msg;

    const startMatch = text.match(/^\s*⭐\s+Run\s+Main\s+([^\s\[]+)/);
    const startJobId = startMatch ? findJobId(startMatch[1]) : null;

    const successMatch = text.match(/(?:✅\s+Success\s+-\s+Main\s+([^\s\[]+)|🏁\s+Job succeeded)/);
    const successJobId = successMatch?.[1] ? findJobId(successMatch[1]) : null;

    const failMatch = text.match(/(?:❌\s+Failure\s+-\s+Main\s+([^\s\[]+)|🏁\s+Job failed)/);
    const failJobId = failMatch?.[1] ? findJobId(failMatch[1]) : null;

    const targetJobId =
      jIdFromJob || prefixJobId || startJobId || successJobId || failJobId;
    if (!targetJobId) continue;

    if (
      failMatch ||
      entry.stepResult === "failure" ||
      text.includes("Job failed") ||
      text.includes("❌  Failure")
    ) {
      result[targetJobId] = "failure";
    } else if (
      successMatch ||
      (entry.stepResult === "success" && text.includes("Success - Main")) ||
      text.includes("Job succeeded")
    ) {
      if (result[targetJobId] !== "failure") {
        result[targetJobId] = "success";
      }
    } else if (startMatch || text.includes("⭐  Run Main")) {
      if (!result[targetJobId]) {
        result[targetJobId] = "running";
      }
    }
  }

  return result;
}

