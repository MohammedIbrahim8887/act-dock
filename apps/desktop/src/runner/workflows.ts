import { readdir, realpath, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseDocument } from "yaml";
import {
  AppError,
  type Project,
  type RunRequest,
  type Workflow,
  type Job,
  defaultMappings,
  type ExecutionSnapshot,
} from "../shared/contracts";
import {
  GITLAB_EVENTS,
  actEventFor,
  materializeGitLabWorkflow,
  parseGitLabPipeline,
} from "./gitlab";
const strings = (v: unknown): string[] =>
  v == null ? [] : (Array.isArray(v) ? v : [v]).map(String);
export async function canonicalProject(path: string) {
  if (!isAbsolute(path))
    throw new AppError("INVALID_PATH", "Provide an absolute project path.");
  const p = await realpath(path);
  if (!(await stat(p)).isDirectory())
    throw new AppError("INVALID_PATH", "Choose a directory.");
  return p;
}
async function discoverGitHub(project: Project): Promise<Workflow[]> {
  const dir = join(project.path, ".github/workflows");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  return Promise.all(
    names
      .filter((n) => /\.ya?ml$/i.test(n))
      .sort()
      .map(async (name) => {
        const w: Workflow = {
          projectId: project.id,
          path: ".github/workflows/" + name,
          name,
          events: [],
          jobs: [],
          inputs: [],
        };
        try {
          await safeWorkflowPath(project, w.path);
          const doc = parseDocument(await readFile(join(dir, name), "utf8"), {
            uniqueKeys: true,
          });
          if (doc.errors.length)
            throw new Error(doc.errors.map((e) => e.message).join("; "));
          const d = doc.toJS();
          if (
            !d ||
            typeof d !== "object" ||
            !d.jobs ||
            typeof d.jobs !== "object"
          )
            throw new Error("Workflow must contain a jobs mapping.");
          w.name = String(d.name || name);
          w.events =
            typeof d.on === "string"
              ? [d.on]
              : Array.isArray(d.on)
                ? d.on.map(String)
                : Object.keys(d.on || {});
          w.jobs = Object.entries(d.jobs).map(([id, v]) => {
            const j = v as Record<string, unknown>;
            if (!j || typeof j !== "object")
              throw new Error(`Invalid job ${id}`);
            return {
              id,
              name: String(j.name || id),
              needs: strings(j.needs),
              runners: strings(j["runs-on"]),
              uses: typeof j.uses === "string" ? j.uses : undefined,
              container: !!j.container,
            };
          });
          const inputs = d.on?.workflow_dispatch?.inputs || {};
          w.inputs = Object.entries(inputs).map(([name, value]) => {
            const i = value as Record<string, unknown>;
            return {
              name,
              type: String(i.type || "string"),
              description: String(i.description || ""),
              required: !!i.required,
              ...(i.default !== undefined
                ? { default: String(i.default) }
                : {}),
              options: strings(i.options),
            };
          });
        } catch (e) {
          w.diagnostic = e instanceof Error ? e.message : String(e);
        }
        return w;
      }),
  );
}

async function discoverGitLab(project: Project): Promise<Workflow[]> {
  const candidates = [".gitlab-ci.yml", ".gitlab-ci.yaml"];
  const found: string[] = [];
  for (const name of candidates) {
    try {
      const s = await stat(join(project.path, name));
      if (s.isFile()) found.push(name);
    } catch {}
  }

  try {
    const gitlabDir = join(project.path, ".gitlab/ci");
    const subFiles = await readdir(gitlabDir);
    for (const f of subFiles) {
      if (/\.ya?ml$/i.test(f)) {
        found.push(join(".gitlab/ci", f));
      }
    }
  } catch {}

  if (found.length === 0) return [];

  return Promise.all(
    found.map(async (relPath) => {
      const w: Workflow = {
        projectId: project.id,
        path: relPath,
        name: "GitLab CI Pipeline",
        events: Object.keys(GITLAB_EVENTS),
        jobs: [],
        inputs: [],
      };
      try {
        await safeWorkflowPath(project, relPath);
        const pipeline = parseGitLabPipeline(
          await readFile(join(project.path, relPath), "utf8"),
        );
        w.jobs = pipeline.jobs.map((j) => ({
          id: j.id,
          name: j.name,
          needs: j.needs,
          runners: [j.runsOn],
          container: j.container,
        }));
        const stages = pipeline.stages.slice(0, 3).join(" → ");
        w.name = `GitLab CI: ${stages}${pipeline.stages.length > 3 ? "…" : ""}`;
      } catch (e) {
        w.diagnostic = e instanceof Error ? e.message : String(e);
      }
      return w;
    }),
  );
}

export async function discover(project: Project): Promise<Workflow[]> {
  const [githubWorkflows, gitlabWorkflows] = await Promise.all([
    discoverGitHub(project),
    discoverGitLab(project),
  ]);
  return [...githubWorkflows, ...gitlabWorkflows];
}

export async function safeWorkflowPath(project: Project, path: string) {
  const gitlab = isGitLabWorkflow(path);
  const candidate = await realpath(resolve(project.path, path));
  const base = await realpath(
    gitlab ? project.path : join(project.path, ".github/workflows"),
  );
  const rel = relative(base, candidate);
  if (
    !rel ||
    rel.startsWith("..") ||
    isAbsolute(rel) ||
    !/\.ya?ml$/i.test(candidate)
  )
    throw new AppError(
      "INVALID_WORKFLOW",
      gitlab
        ? "Select a GitLab CI YAML file inside the project directory."
        : "Select a YAML file inside .github/workflows.",
    );
  return candidate;
}
export const defaultEvent = (w: Workflow) =>
  ["workflow_dispatch", "push"].find((e) => w.events.includes(e)) ||
  w.events[0] ||
  "push";
export async function validateRun(project: Project, request: RunRequest) {
  await safeWorkflowPath(project, request.workflowPath);
  const w = (await discover(project)).find(
    (w) => w.path === request.workflowPath,
  );
  if (!w || w.diagnostic)
    throw new AppError(
      "INVALID_WORKFLOW",
      w?.diagnostic || "Workflow not found. Refresh workflows.",
    );
  if (!w.events.includes(request.event))
    throw new AppError(
      "INVALID_EVENT",
      "Choose an event declared by this workflow.",
    );
  if (request.jobId && !w.jobs.some((j) => j.id === request.jobId))
    throw new AppError(
      "INVALID_JOB",
      "Job no longer exists. Refresh workflows.",
    );
  const jobs = new Map(w.jobs.map((j) => [j.id, j]));
  const selected = new Map<string, Job>();
  function visit(j: Job) {
    if (selected.has(j.id)) return;
    selected.set(j.id, j);
    for (const dep of j.needs) {
      const p = jobs.get(dep);
      if (!p) throw new AppError("INVALID_JOB", `Missing dependency ${dep}`);
      visit(p);
    }
  }
  (request.jobId ? [jobs.get(request.jobId)!] : w.jobs).forEach(visit);
  for (const j of selected.values()) {
    if (
      (!j.runners.length && !j.uses) ||
      (!j.container &&
        j.runners.length > 0 &&
        !j.runners.some(
          (r) =>
            /^ubuntu-(latest|20\.04|22\.04|24\.04)$/i.test(r) ||
            !!request.execution?.runnerMappings?.[r.toLowerCase()] ||
            r.includes("${{"),
        ))
    )
      throw new AppError(
        "UNSUPPORTED_RUNNER",
        `${j.name} uses ${j.runners.join(", ") || "a reusable workflow"}. Map a Linux runner label to a Docker image in project settings.`,
      );
  }
  if (request.event === "workflow_dispatch")
    for (const i of w.inputs) {
      const value = request.inputs[i.name] ?? i.default;
      if (i.required && (value === undefined || value === ""))
        throw new AppError("INPUT_REQUIRED", `${i.name} is required.`);
      if (value !== undefined && value !== "") {
        if (i.type === "boolean" && !["true", "false"].includes(value))
          throw new AppError(
            "INVALID_INPUT",
            `${i.name} must be true or false.`,
          );
        if (i.type === "choice" && !i.options.includes(value))
          throw new AppError(
            "INVALID_INPUT",
            `Choose a valid value for ${i.name}.`,
          );
        if (i.type === "number" && !Number.isFinite(Number(value)))
          throw new AppError("INVALID_INPUT", `${i.name} must be a number.`);
      }
    }
  for (const key of ["eventFile", "envFile", "varFile", "secretFile"] as const)
    if (request[key]) {
      const p = resolve(project.path, request[key]!);
      if (!(await stat(p)).isFile())
        throw new AppError("INVALID_FILE", `${key} must refer to a file.`);
      if (key === "eventFile") JSON.parse(await readFile(p, "utf8"));
    }
  return w;
}
/** The image act uses for ubuntu-* runners. */
export const RUNNER_IMAGE = "catthehacker/ubuntu:act-24.04";

export function isGitLabWorkflow(workflowPath: string): boolean {
  const norm = workflowPath.toLowerCase();
  return (
    norm === ".gitlab-ci.yml" ||
    norm === ".gitlab-ci.yaml" ||
    norm.includes(".gitlab/ci/")
  );
}

export function commandArgs(
  project: Project,
  r: RunRequest,
  runId: string,
  snapshot?: ExecutionSnapshot,
) {
  let targetWorkflow = resolve(project.path, r.workflowPath);
  let event = r.event;
  // GitLab pipelines run from their normalized GitHub-style form (see gitlab.ts).
  if (isGitLabWorkflow(r.workflowPath)) {
    targetWorkflow = materializeGitLabWorkflow(project.path, r.workflowPath);
    event = actEventFor(r.event);
  }
  const targetJobId = r.jobId;

  const args = [
    event,
    "-W",
    targetWorkflow,
    "--json",
    "--rm",
    "--insecure-secrets=false",
    "--container-options",
    `--label act-dock.run=${runId}`,
  ];
  if (targetJobId) args.push("-j", targetJobId);
  const mappings = snapshot?.options.runnerMappings || defaultMappings;
  for (const [label, reference] of Object.entries(mappings)) {
    const image =
      snapshot?.images.find((i) => i.reference === reference && i.available)
        ?.resolved || reference;
    args.push("-P", `${label}=${image}`);
  }
  if (snapshot) {
    args.push("--pull=false", "--reuse=false");
    if (snapshot.options.concurrentJobs)
      args.push("--concurrent-jobs", String(snapshot.options.concurrentJobs));
    if (snapshot.options.workspaceMode === "bind") args.push("--bind");
  }
  for (const [key, value] of Object.entries(r.inputs))
    args.push("--input", `${key}=${value}`);
  for (const [key, flag] of [
    ["eventFile", "--eventpath"],
    ["envFile", "--env-file"],
    ["varFile", "--var-file"],
    ["secretFile", "--secret-file"],
  ] as const)
    if (r[key]) args.push(flag, resolve(project.path, r[key]!));
  if (r.architecture !== "auto")
    args.push("--container-architecture", r.architecture);
  return args;
}
