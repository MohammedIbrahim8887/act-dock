import { describe, expect, test } from "bun:test";
import type { LogEntry } from "../src/shared/contracts";
import { advanceProgress, currentSteps, isCurrentStepLine } from "../src/shared/run-progress";

function line(cursor: number, message: string, extra: Partial<LogEntry> = {}): LogEntry {
  return { cursor, message, time: new Date(0).toISOString(), stream: "stdout", job: "check", ...extra };
}

describe("act step progress", () => {
  test("handles multiline run commands and arbitrary legacy job IDs", () => {
    const state = advanceProgress({}, [
      line(1, "⭐ Run Main echo first\necho second", { job: "__proto__" }),
      line(2, "⭐ Run Main Another job", { job: "constructor" }),
    ]);
    expect(currentSteps(state).map(s => s.name)).toEqual(["Main echo first\necho second", "Main Another job"]);
    expect(currentSteps(advanceProgress(state, [line(3, "🏁 Job succeeded", { job: "__proto__" })]))).toHaveLength(1);
  });
  test("tracks setup and main steps from existing logs and clears completed steps", () => {
    let state = advanceProgress({}, [line(1, "⭐ Run Set up job"), line(2, "Pulling image")]);
    expect(currentSteps(state)[0].name).toBe("Set up job");
    state = advanceProgress(state, [line(3, "  ✅  Success - Set up job"), line(4, "⭐ Run Main Check types")]);
    expect(currentSteps(state)[0].name).toBe("Main Check types");
    state = advanceProgress(state, [line(5, "  ❌  Failure - Main Check types [1s]")]);
    expect(currentSteps(state)).toEqual([]);
  });

  test("tracks interleaved matrix jobs without highlighting unrelated output", () => {
    const entries = [
      line(1, "⭐ Run Main Test Node 20", { jobKey: "matrix-20" }),
      line(2, "⭐ Run Main Test Node 22", { jobKey: "matrix-22" }),
      line(3, "test output", { jobKey: "matrix-20", rawOutput: true }),
    ];
    let state = advanceProgress({}, entries);
    const active = currentSteps(state);
    expect(active).toHaveLength(2);
    expect(isCurrentStepLine(entries[2], active)).toBe(true);
    expect(isCurrentStepLine(line(4, "other output", { job: "build" }), active)).toBe(false);
    state = advanceProgress(state, [line(4, "✅ Success - Main Test Node 20", { jobKey: "matrix-20" })]);
    expect(currentSteps(state).map(s => s.jobKey)).toEqual(["matrix-22"]);
  });

  test("restores parent action after nested steps and distinguishes main from post", () => {
    let state = advanceProgress({}, [
      line(1, "⭐ Run Main Composite", { stepId: ["1"], stage: "Main" }),
      line(2, "⭐ Run Main Inner", { stepId: ["1", "0"], stage: "Main" }),
    ]);
    expect(currentSteps(state)[0].name).toBe("Main Inner");
    state = advanceProgress(state, [line(3, "✅ Success - Main Inner", { stepId: ["1", "0"], stage: "Main", stepResult: "success" })]);
    expect(currentSteps(state)[0].name).toBe("Main Composite");
    state = advanceProgress(state, [
      line(4, "✅ Success - Main Composite", { stepId: ["1"], stage: "Main", stepResult: "success" }),
      line(5, "⭐ Run Post Composite", { stepId: ["1"], stage: "Post" }),
      line(6, "late completion", { stepId: ["1"], stage: "Main", stepResult: "success" }),
    ]);
    expect(currentSteps(state)[0].name).toBe("Post Composite");
    state = advanceProgress(state, [line(7, "Job succeeded")]);
    expect(currentSteps(state)).toEqual([]);
  });

  test("keeps step context across log pages after the start scrolls out of the window", () => {
    let state = advanceProgress({}, [line(1, "⭐ Run Main Long tests")]);
    for (let page = 0; page < 3; page++) {
      state = advanceProgress(state, Array.from({ length: 1000 }, (_, i) => line(page * 1000 + i + 2, "test output", { rawOutput: true })));
    }
    expect(currentSteps(state)[0].cursor).toBe(1);
    expect(isCurrentStepLine(line(3002, "latest output"), currentSteps(state))).toBe(true);
  });

  test("ignores lifecycle-like user output and accepts old text job prefixes", () => {
    const state = advanceProgress({}, [
      line(1, "[check] ⭐ Run Main Test", { job: undefined }),
      line(2, "⭐ Run Main Spoof", { rawOutput: true }),
      line(3, "✅ Success - Main Test", { rawOutput: true }),
      line(4, "Run bun test"),
    ]);
    expect(currentSteps(state)[0].name).toBe("Main Test");
    expect(isCurrentStepLine(line(5, "[check] output", { job: undefined }), currentSteps(state))).toBe(true);
  });
});
