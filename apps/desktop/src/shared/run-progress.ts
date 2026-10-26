import type { LogEntry } from "./contracts";

export type ActiveStep = {
  jobKey: string;
  job?: string;
  name: string;
  cursor: number;
  stepId?: string[];
  stage?: string;
};
export type RunProgress = Record<string, ActiveStep[]>;

function context(entry: LogEntry) {
  const prefix = !entry.job ? entry.message.match(/^\[([^\]]+)\]\s*/) : null;
  const job = entry.job || prefix?.[1];
  return {
    job,
    key: entry.jobKey || job || "unassigned",
    message: prefix ? entry.message.slice(prefix[0].length) : entry.message,
  };
}

function contains(parent: string[], child: string[]) {
  return parent.length < child.length && parent.every((id, i) => child[i] === id);
}

// Consume every page, independently of the bounded visible log window. Composite
// actions form a stack; concurrent jobs (including matrix jobs) stay independent.
// Message markers match act v0.2.89 pkg/runner/{step,run_context}.go.
export function advanceProgress(previous: RunProgress, entries: LogEntry[]): RunProgress {
  const next: RunProgress = Object.assign(Object.create(null), previous);
  for (const entry of entries) {
    if (entry.rawOutput) continue;
    const { job, key, message } = context(entry);
    const start = message.match(/^\s*⭐\s+Run\s+([\s\S]+)$/u);
    if (start) {
      const step: ActiveStep = {
        jobKey: key, job, name: start[1].trim(), cursor: entry.cursor,
        stepId: entry.stepId, stage: entry.stage,
      };
      const stack = next[key] || [];
      const parent = stack.at(-1);
      next[key] = parent?.stepId && step.stepId && contains(parent.stepId, step.stepId)
        ? [...stack, step] : [step];
    } else if (/^\s*(?:🏁\s*)?Job (?:succeeded|failed)\b/u.test(message)) {
      delete next[key];
    } else if (entry.stepResult || /^\s*[✅❌]\s+(?:Success|Failure)\s+-\s+/u.test(message)) {
      const stack = next[key];
      if (!stack) continue;
      let index = stack.length - 1;
      if (entry.stepId) {
        while (index >= 0 && !(stack[index].stage === entry.stage &&
          JSON.stringify(stack[index].stepId) === JSON.stringify(entry.stepId))) index--;
      }
      if (index < 0) continue;
      if (index === 0) delete next[key];
      else next[key] = stack.slice(0, index);
    }
  }
  return next;
}

export function currentSteps(progress: RunProgress): ActiveStep[] {
  return Object.values(progress).flatMap(stack => stack.length ? [stack[stack.length - 1]] : []);
}

export function isCurrentStepLine(entry: LogEntry, steps: ActiveStep[]) {
  const { key } = context(entry);
  return steps.some(step => step.jobKey === key && entry.cursor >= step.cursor &&
    (!entry.stepId || !step.stepId ||
      JSON.stringify(entry.stepId) === JSON.stringify(step.stepId)));
}
