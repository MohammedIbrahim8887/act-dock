import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument, stringify } from "yaml";
import { AppError } from "../shared/contracts";

/**
 * GitLab CI support. A GitLab pipeline is normalized once into a small model
 * (jobs with resolved scripts, stages turned into explicit `needs`), and that
 * model is turned into a GitHub-style workflow that Act can execute. Discovery,
 * validation, analysis and execution all read the same normalized result, so
 * they cannot disagree about which jobs exist or what they depend on.
 */

/** Events offered for GitLab pipelines, and the Act event each one runs as. */
export const GITLAB_EVENTS: Record<string, string> = {
  push: "push",
  merge_request: "pull_request",
  manual: "workflow_dispatch",
};

export function actEventFor(event: string): string {
  return GITLAB_EVENTS[event] ?? event;
}

/** GitLab's built-in stages, used when a pipeline does not declare `stages`. */
const DEFAULT_STAGES = [".pre", "build", "test", "deploy", ".post"];
const DEFAULT_STAGE = "test";
const RESERVED = new Set([
  "stages",
  "variables",
  "default",
  "include",
  "workflow",
  "image",
  "services",
  "before_script",
  "after_script",
  "cache",
]);
const DEFAULT_KEYS = [
  "before_script",
  "after_script",
  "image",
  "tags",
  "variables",
] as const;
export const DEFAULT_RUNNER = "ubuntu-latest";

type Obj = Record<string, unknown>;

export type GitLabJob = {
  /** Stable id: the job name with characters Act does not accept replaced. */
  id: string;
  /** The job name as written in the pipeline. */
  name: string;
  needs: string[];
  runsOn: string;
  env: Record<string, string>;
  script: string[];
  afterScript: string[];
  allowFailure: boolean;
  container: boolean;
};

export type GitLabPipeline = {
  stages: string[];
  jobs: GitLabJob[];
};

const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const SCALARS = ["string", "number", "boolean"];
/** Script-like values: a string or a list of strings. Anything else is an error, never coerced. */
const lines = (v: unknown, key: string): string[] => {
  if (v === undefined || v === null) return [];
  const items = Array.isArray(v) ? v.flat(Infinity) : [v];
  if (!items.every((item) => SCALARS.includes(typeof item)))
    throw new Error(
      `${key} must be a string or a list of strings. Quote commands that contain ": ".`,
    );
  return items.map(String);
};

/** Child values replace parent values; plain mappings (such as variables) merge. */
function mergeConfig(base: Obj, over: Obj): Obj {
  const out: Obj = { ...base };
  for (const [key, value] of Object.entries(over)) {
    out[key] =
      isObj(value) && isObj(base[key])
        ? { ...(base[key] as Obj), ...value }
        : value;
  }
  return out;
}

function resolveJob(
  key: string,
  raw: Obj,
  templates: Map<string, Obj>,
  defaults: Obj,
  chain: string[] = [],
): Obj {
  if (chain.includes(key))
    throw new Error(
      `${[...chain, key].join(" → ")} extends itself. Remove the cycle.`,
    );
  const parents =
    raw.extends === undefined
      ? []
      : Array.isArray(raw.extends)
        ? raw.extends.map(String)
        : [String(raw.extends)];
  let inherited: Obj = {};
  for (const parent of parents) {
    const template = templates.get(parent);
    if (!template)
      throw new Error(`${key} extends ${parent}, which is not defined.`);
    inherited = mergeConfig(
      inherited,
      resolveJob(parent, template, templates, defaults, [...chain, key]),
    );
  }
  const { extends: _extends, ...own } = raw;
  return mergeConfig(mergeConfig(defaults, inherited), own);
}

/** Parse GitLab CI YAML into a normalized pipeline. Throws with a readable reason. */
export function parseGitLabPipeline(raw: string): GitLabPipeline {
  const doc = parseDocument(raw, { uniqueKeys: false });
  if (doc.errors.length)
    throw new Error(doc.errors.map((e) => e.message).join("; "));
  const root = doc.toJS() as unknown;
  if (!isObj(root)) throw new Error("GitLab CI file must contain a mapping.");
  if ("include" in root)
    throw new Error(
      "include is not supported yet. Inline the included jobs into this file.",
    );

  const stages =
    root.stages === undefined
      ? DEFAULT_STAGES
      : lines(root.stages, "stages");
  if (stages.length === 0) throw new Error("stages must not be empty.");

  const defaults: Obj = {};
  if (isObj(root.default))
    for (const k of DEFAULT_KEYS)
      if (root.default[k] !== undefined) defaults[k] = root.default[k];
  for (const k of ["before_script", "after_script", "image"] as const)
    if (root[k] !== undefined && defaults[k] === undefined)
      defaults[k] = root[k];
  const globalVariables = isObj(root.variables) ? root.variables : {};

  const templates = new Map<string, Obj>();
  const declared = new Map<string, Obj>();
  for (const [key, value] of Object.entries(root)) {
    if (RESERVED.has(key) || !isObj(value)) continue;
    if (key.startsWith(".")) templates.set(key, value);
    else declared.set(key, value);
  }

  const ids = new Map<string, string>(); // id -> job name
  const resolved = new Map<string, Obj>();
  for (const [name, raw] of declared) {
    const job = resolveJob(name, raw, templates, defaults);
    if (job.trigger !== undefined)
      throw new Error(`${name} is a trigger job, which is not supported yet.`);
    const id = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    if (ids.has(id))
      throw new Error(
        `Jobs "${ids.get(id)}" and "${name}" map to the same id. Rename one of them.`,
      );
    ids.set(id, name);
    resolved.set(name, job);
  }

  const stageIndex = (name: string, job: Obj) => {
    const stage = job.stage === undefined ? DEFAULT_STAGE : String(job.stage);
    const index = stages.indexOf(stage);
    if (index < 0)
      throw new Error(
        `${name} uses stage "${stage}", which is not listed in stages.`,
      );
    return index;
  };

  const jobs: GitLabJob[] = [];
  for (const [name, job] of resolved) {
    const script = lines(job.script, `${name}.script`);
    if (script.length === 0)
      throw new Error(`${name} has no script. Add script to the job or its parent.`);
    const needs: string[] = [];
    if (job.needs !== undefined) {
      // An explicit `needs` replaces stage ordering for this job, as in GitLab.
      const list = Array.isArray(job.needs) ? job.needs : [job.needs];
      for (const item of list) {
        const dep = typeof item === "string" ? item : isObj(item) ? item.job : undefined;
        if (typeof dep !== "string")
          throw new Error(`${name} has an invalid needs entry.`);
        if (isObj(item) && (item.project || item.pipeline))
          throw new Error(`${name} needs a job from another pipeline, which is not supported yet.`);
        if (!resolved.has(dep)) {
          if (isObj(item) && item.optional === true) continue;
          throw new Error(`${name} needs ${dep}, which is not a job in this pipeline.`);
        }
        needs.push(dep.replace(/[^a-zA-Z0-9_-]/g, "_"));
      }
    } else {
      const mine = stageIndex(name, job);
      for (const [other, otherJob] of resolved)
        if (other !== name && stageIndex(other, otherJob) < mine)
          needs.push(other.replace(/[^a-zA-Z0-9_-]/g, "_"));
    }
    const tags = lines(job.tags, `${name}.tags`);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries({
      ...globalVariables,
      ...(isObj(job.variables) ? job.variables : {}),
    }))
      if (["string", "number", "boolean"].includes(typeof v)) env[k] = String(v);
    jobs.push({
      id: name.replace(/[^a-zA-Z0-9_-]/g, "_"),
      name,
      needs: [...new Set(needs)],
      runsOn: tags[0] || DEFAULT_RUNNER,
      env,
      script: [...lines(job.before_script, `${name}.before_script`), ...script],
      afterScript: lines(job.after_script, `${name}.after_script`),
      allowFailure: job.allow_failure === true,
      container: job.image !== undefined,
    });
  }

  const byId = new Map(jobs.map((j) => [j.id, j]));
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting")
      throw new Error(`Job ${id} depends on itself through needs. Remove the cycle.`);
    state.set(id, "visiting");
    for (const dep of byId.get(id)!.needs) visit(dep);
    state.set(id, "done");
  };
  jobs.forEach((j) => visit(j.id));

  return { stages, jobs };
}

/** The GitHub-style workflow Act runs for a normalized GitLab pipeline. */
export function buildGitLabWorkflow(pipeline: GitLabPipeline, name: string) {
  const jobs: Obj = {};
  for (const job of pipeline.jobs) {
    const steps: Obj[] = [
      { name: job.name, shell: "bash", run: job.script.join("\n") },
    ];
    if (job.afterScript.length > 0)
      steps.push({
        name: `${job.name} (after_script)`,
        if: "always()",
        shell: "bash",
        run: job.afterScript.join("\n"),
      });
    jobs[job.id] = {
      name: job.name,
      "runs-on": job.runsOn,
      ...(job.needs.length > 0 ? { needs: job.needs } : {}),
      ...(job.allowFailure ? { "continue-on-error": true } : {}),
      ...(Object.keys(job.env).length > 0 ? { env: job.env } : {}),
      steps,
    };
  }
  return {
    name: `GitLab CI: ${name}`,
    on: { push: {}, pull_request: {}, workflow_dispatch: {} },
    jobs,
  };
}

/** Read a GitLab CI file from disk and normalize it. The path must already be validated. */
export function readGitLabPipeline(fullPath: string): GitLabPipeline {
  return parseGitLabPipeline(readFileSync(fullPath, "utf8"));
}

/**
 * Write the normalized pipeline for `relPath` into the project's `.act-dock`
 * folder and return that file, which is what Act is pointed at. The file name
 * is derived from the source path so several GitLab files never overwrite
 * each other.
 */
export function materializeGitLabWorkflow(
  projectPath: string,
  relPath: string,
): string {
  let pipeline: GitLabPipeline;
  try {
    pipeline = readGitLabPipeline(join(projectPath, relPath));
  } catch (e) {
    throw new AppError(
      "INVALID_WORKFLOW",
      e instanceof Error ? e.message : String(e),
    );
  }
  const name = relPath.split("/").pop() || relPath;
  const digest = createHash("sha256").update(relPath).digest("hex").slice(0, 12);
  const outDir = join(projectPath, ".act-dock/workflows");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `gitlab-${digest}.yml`);
  writeFileSync(
    out,
    stringify(buildGitLabWorkflow(pipeline, name), { lineWidth: 0 }),
    "utf8",
  );
  return out;
}
