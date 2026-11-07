import { describe, expect, test } from "bun:test";
import type { LogEntry } from "../src/shared/contracts";
import {
  createLogReader,
  parseJobStatusesFromLogs,
} from "../src/mainview/lib/job-status";

const jobs = [
  { id: "build", name: "build" },
  { id: "test", name: "Unit tests" },
];
const entry = (message: string, job?: string) =>
  ({ cursor: 0, time: "", stream: "stdout", message, job }) as LogEntry;

describe("job status from act logs", () => {
  test("a finished step does not mark the job as passed", () => {
    const status = parseJobStatusesFromLogs(jobs, [
      entry("⭐ Run Main setup", "build"),
      entry("  ✅  Success - Main setup", "build"),
      entry("⭐ Run Main run tests", "build"),
    ]);
    expect(status.build).toBe("running");
  });

  test("only job-level completion sets a terminal status", () => {
    expect(
      parseJobStatusesFromLogs(jobs, [
        entry("⭐ Run Main setup", "build"),
        entry("🏁  Job succeeded", "build"),
      ]).build,
    ).toBe("success");
    expect(
      parseJobStatusesFromLogs(jobs, [
        entry("⭐ Run Main setup", "build"),
        entry("  ❌  Failure - Main setup", "build"),
        entry("🏁  Job failed", "build"),
      ]).build,
    ).toBe("failure");
  });

  test("a step failure under continue-on-error does not fail the job", () => {
    const status = parseJobStatusesFromLogs(jobs, [
      entry("⭐ Run Main lint", "build"),
      entry("  ❌  Failure - Main lint", "build"),
      entry("⭐ Run Main publish", "build"),
      entry("🏁  Job succeeded", "build"),
    ]);
    expect(status.build).toBe("success");
  });

  test("matrix executions roll up into one job status", () => {
    const pending = parseJobStatusesFromLogs(jobs, [
      entry("⭐ Run Main test", "test (node 18)"),
      entry("⭐ Run Main test", "test (node 20)"),
      entry("🏁  Job succeeded", "test (node 18)"),
    ]);
    expect(pending.test).toBe("running");

    const failed = parseJobStatusesFromLogs(jobs, [
      entry("⭐ Run Main test", "test (node 18)"),
      entry("🏁  Job succeeded", "test (node 18)"),
      entry("⭐ Run Main test", "test (node 20)"),
      entry("🏁  Job failed", "test (node 20)"),
    ]);
    expect(failed.test).toBe("failure");

    const passed = parseJobStatusesFromLogs(jobs, [
      entry("🏁  Job succeeded", "test (node 18)"),
      entry("🏁  Job succeeded", "test (node 20)"),
    ]);
    expect(passed.test).toBe("success");
  });

  test("a completed execution is not reopened by a later step", () => {
    const status = parseJobStatusesFromLogs(jobs, [
      entry("🏁  Job succeeded", "build"),
      entry("⭐ Run Main late", "build"),
    ]);
    expect(status.build).toBe("success");
  });
});

describe("paged log reading", () => {
  // 5,000 log lines delivered in 2,000-line pages, with the completion marker
  // on the last page — the case the old single-request refresh missed.
  const logs: LogEntry[] = Array.from({ length: 5000 }, (_, i) =>
    entry(i === 4500 ? "🏁  Job succeeded" : "output", "build"),
  );
  const fetchPage = (calls: number[]) => async (cursor: number) => {
    calls.push(cursor);
    const slice = logs.slice(cursor, cursor + 2000);
    return {
      entries: slice,
      nextCursor: cursor + slice.length,
      end: cursor + slice.length >= logs.length,
    };
  };

  test("reads every page so completion markers past the first page are seen", async () => {
    const calls: number[] = [];
    const read = createLogReader(fetchPage(calls));
    const entries = await read();
    expect(calls).toEqual([0, 2000, 4000]);
    expect(entries.length).toBe(5000);
    expect(parseJobStatusesFromLogs(jobs, entries).build).toBe("success");
  });

  test("a later refresh continues from the saved cursor", async () => {
    const calls: number[] = [];
    const read = createLogReader(fetchPage(calls));
    await read();
    calls.length = 0;
    logs.push(entry("more output", "build"));
    const entries = await read();
    expect(calls).toEqual([5000]);
    expect(entries.length).toBe(5001);
  });
});
