import { readdir, realpath, readFile, stat } from "node:fs/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
const GITLAB_RESERVED = new Set([
  "stages",
  "variables",
  "default",
  "include",
  "image",
  "services",
  "before_script",
  "after_script",
  "cache",
  "workflow",
  "pages",
]);

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
      const fullPath = join(project.path, relPath);
      const fileName = relPath.split("/").pop() || relPath;
      const w: Workflow = {
        projectId: project.id,
        path: relPath,
        name: "GitLab CI Pipeline",
        events: ["push", "merge_request", "schedule", "manual"],
        jobs: [],
        inputs: [],
      };

      try {
        await safeWorkflowPath(project, w.path);
        const raw = await readFile(fullPath, "utf8");
        const doc = parseDocument(raw, { uniqueKeys: false });
        const d = (doc.toJS() || {}) as Record<string, unknown>;

        const jobs: Job[] = [];
        for (const [key, value] of Object.entries(d)) {
          if (GITLAB_RESERVED.has(key) || key.startsWith(".")) continue;
          if (typeof value === "object" && value !== null) {
            const j = value as Record<string, unknown>;
            const needs: string[] = [];
            if (Array.isArray(j.needs)) {
              for (const n of j.needs) {
                if (typeof n === "string") needs.push(n);
                else if (typeof n === "object" && n !== null && "job" in n) {
                  needs.push(String((n as { job: unknown }).job));
                }
              }
            } else if (typeof j.needs === "string") {
              needs.push(j.needs);
            }
            jobs.push({
              id: key,
              name: String(j.name || key),
              needs,
              runners: strings(j.tags),
              uses: typeof j.extends === "string" ? j.extends : undefined,
              container: !!j.image,
            });
          }
        }

        w.jobs = jobs;
        if (Array.isArray(d.stages) && d.stages.length > 0) {
          const stagesStr = d.stages.slice(0, 3).join(" → ");
          w.name = `GitLab CI: ${stagesStr}${d.stages.length > 3 ? "…" : ""}`;
        }
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
  const candidate = await realpath(resolve(project.path, path));
  const projectBase = await realpath(project.path);
  const rel = relative(projectBase, candidate);
  if (
    rel.startsWith("..") ||
    isAbsolute(rel) ||
    !/\.ya?ml$/i.test(candidate)
  )
    throw new AppError(
      "INVALID_WORKFLOW",
      "Select a YAML file inside the project directory.",
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
            r.toLowerCase() === "mtx-runner" ||
            r.toLowerCase() === "self-hosted" ||
            r.toLowerCase() === "linux" ||
            r.toLowerCase() === "docker" ||
            r.includes("${{"),
        ))
    ) {
      const isExplicitUnsupported = j.runners.some((r) =>
        /^(macos|windows)/i.test(r),
      );
      if (isExplicitUnsupported) {
        throw new AppError(
          "UNSUPPORTED_RUNNER",
          `${j.name} uses ${j.runners.join(", ")}. macOS and Windows runners are not supported in local containers.`,
        );
      }
      if (request.execution?.runnerMappings) {
        for (const r of j.runners) {
          const key = r.toLowerCase();
          if (!request.execution.runnerMappings[key]) {
            request.execution.runnerMappings[key] = RUNNER_IMAGE;
          }
        }
      }
    }
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

export function prepareGitLabWorkflowSync(
  projectPath: string,
  workflowPath: string,
): string {
  const fullPath = resolve(projectPath, workflowPath);
  const raw = readFileSync(fullPath, "utf8");
  const doc = parseDocument(raw, { uniqueKeys: false });
  const d = (doc.toJS() || {}) as Record<string, unknown>;

  let out =
    "name: GitLab CI\non:\n  push:\n  pull_request:\n  workflow_dispatch:\n";
  const globalVars = (d.variables as Record<string, unknown>) || {};
  const globalBefore = Array.isArray(d.before_script)
    ? d.before_script.map(String)
    : [];

  const envs = Object.entries(globalVars).filter(
    ([, v]) =>
      typeof v === "string" || typeof v === "number" || typeof v === "boolean",
  );
  if (envs.length > 0) {
    out += "env:\n";
    for (const [k, v] of envs) {
      out += `  ${k}: "${String(v).replace(/"/g, '\\"')}"\n`;
    }
  }

  const validJobMap = new Map<string, string>();
  for (const [key, value] of Object.entries(d)) {
    if (
      GITLAB_RESERVED.has(key) ||
      key.startsWith(".") ||
      typeof value !== "object" ||
      !value
    )
      continue;
    validJobMap.set(key, key.replace(/[^a-zA-Z0-9_-]/g, "_"));
  }

  out += "jobs:\n";
  for (const [key, value] of Object.entries(d)) {
    if (!validJobMap.has(key)) continue;
    const j = value as Record<string, unknown>;
    const safeId = validJobMap.get(key)!;
    const tags = strings(j.tags);
    const runner = tags[0] || "mtx-runner";

    out += `  ${safeId}:\n`;
    out += `    name: "${key.replace(/"/g, '\\"')}"\n`;
    out += `    runs-on: "${runner}"\n`;

    const rawNeeds: string[] = [];
    if (Array.isArray(j.needs)) {
      for (const item of j.needs) {
        if (typeof item === "string") rawNeeds.push(item);
        else if (
          typeof item === "object" &&
          item !== null &&
          "job" in item &&
          typeof (item as { job: unknown }).job === "string"
        ) {
          rawNeeds.push((item as { job: string }).job);
        }
      }
    } else if (typeof j.needs === "string") {
      rawNeeds.push(j.needs);
    }

    const safeNeeds = rawNeeds
      .map((needKey) => validJobMap.get(needKey))
      .filter((safeDep): safeDep is string => Boolean(safeDep));

    if (safeNeeds.length > 0) {
      out += `    needs: [${safeNeeds.join(", ")}]\n`;
    }

    out += `    steps:\n`;
    const scripts: string[] = [];
    if (Array.isArray(j.before_script))
      scripts.push(...j.before_script.flat(Infinity).map(String));
    else if (globalBefore.length > 0) scripts.push(...globalBefore);

    if (Array.isArray(j.script))
      scripts.push(...j.script.flat(Infinity).map(String));
    else if (typeof j.script === "string") scripts.push(j.script);
    else scripts.push(`echo "Completed ${key}"`);

    out += `      - name: "${key.replace(/"/g, '\\"')}"\n`;
    out += `        shell: bash\n`;
    out += `        run: |\n`;
    out += `          if ! command -v envsubst >/dev/null 2>&1; then\n`;
    out += `            cat << 'ACTDOCK_ENVSUBST' > /tmp/envsubst 2>/dev/null || true\n`;
    out += `#!/usr/bin/env python3\n`;
    out += `import os, sys, re\n`;
    out += `pattern = re.compile(r'\\$\\{([A-Za-z0-9_]+)\\}|\\$([A-Za-z0-9_]+)')\n`;
    out += `def repl(m):\n`;
    out += `    k = m.group(1) or m.group(2)\n`;
    out += `    return os.environ.get(k, '')\n`;
    out += `sys.stdout.write(pattern.sub(repl, sys.stdin.read()))\n`;
    out += `ACTDOCK_ENVSUBST\n`;
    out += `            chmod +x /tmp/envsubst 2>/dev/null || true\n`;
    out += `            export PATH="/tmp:$PATH"\n`;
    out += `          fi\n`;
    for (const line of scripts) {
      for (const sub of line.split("\n")) {
        out += `          ${sub}\n`;
      }
    }
  }

  const outDir = join(projectPath, ".act-dock/workflows");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "gitlab-ci.yml");
  writeFileSync(outFile, out, "utf8");
  return outFile;
}

export function commandArgs(
  project: Project,
  r: RunRequest,
  runId: string,
  snapshot?: ExecutionSnapshot,
) {
  let targetWorkflow = resolve(project.path, r.workflowPath);
  let targetJobId = r.jobId;

  if (isGitLabWorkflow(r.workflowPath)) {
    targetWorkflow = prepareGitLabWorkflowSync(project.path, r.workflowPath);
    if (r.jobId) {
      targetJobId = r.jobId.replace(/[^a-zA-Z0-9_-]/g, "_");
    }
  }

  const args = [
    r.event,
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
