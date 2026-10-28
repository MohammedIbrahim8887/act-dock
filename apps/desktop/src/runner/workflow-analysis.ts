import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative, isAbsolute } from "node:path";
import { parseDocument } from "yaml";
import { AppError, type Project, type RunRequest } from "../shared/contracts";

export type DocumentData = {
  name?: string;
  jobs?: Record<
    string,
    {
      name?: unknown;
      needs?: unknown;
      "runs-on"?: unknown;
      uses?: string;
      strategy?: unknown;
      services?: Record<string, unknown>;
      container?: string | { image?: string; options?: string };
      steps?: { uses?: string; run?: string }[];
    }
  >;
  runs?: { using?: string; steps?: { uses?: string }[] };
};
export async function yamlData(path: string): Promise<DocumentData> {
  const file = Bun.file(path);
  if (file.size > 4 * 1024 * 1024)
    throw new AppError(
      "CONFIG_TOO_LARGE",
      "Workflow and action files must be smaller than 4 MiB.",
    );
  const doc = parseDocument(await file.text(), { uniqueKeys: true });
  if (doc.errors.length)
    throw new AppError(
      "INVALID_WORKFLOW",
      "YAML could not be parsed. Correct the file, then retry.",
    );
  return doc.toJS() as DocumentData;
}
export function actContainerName(...parts: string[]) {
  const name = parts
    .join("-")
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replaceAll("--", "-");
  const trimmed = name
    .slice(name.length > 63 ? name.length - 63 : 0)
    .replace(/^-+|-+$/g, "");
  // Match Act's trimToLen (it keeps the beginning, not a project-specific namespace).
  const prefix =
    name.length > 63 ? name.slice(0, 63).replace(/^-+|-+$/g, "") : trimmed;
  return `${prefix}-${createHash("sha256").update(name).digest("hex")}`;
}
export async function analyzeWorkflow(project: Project, request: RunRequest) {
  const path = resolve(project.path, request.workflowPath),
    data = await yamlData(path);
  const jobs = data.jobs || {},
    selected = new Set<string>();
  const visit = (id: string, visiting = new Set<string>()) => {
    if (visiting.has(id))
      throw new AppError(
        "INVALID_WORKFLOW",
        "The workflow has a dependency cycle.",
      );
    if (selected.has(id)) return;
    const job = jobs[id];
    if (!job) throw new AppError("INVALID_JOB", `Missing job ${id}`);
    visiting.add(id);
    for (const need of Array.isArray(job.needs)
      ? job.needs
      : job.needs
        ? [job.needs]
        : [])
      visit(String(need), visiting);
    visiting.delete(id);
    selected.add(id);
  };
  for (const id of request.jobId ? [request.jobId] : Object.keys(jobs))
    visit(id);
  const namespace = new Set<string>();
  let exclusive = false,
    toolcache = false,
    managedConflict = false;
  const images = new Map<string, string>(),
    actions: string[] = [],
    secretNames = new Set<string>();
  const content = await readFile(path, "utf8");
  for (const m of content.matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g))
    secretNames.add(m[1].toUpperCase());
  for (const id of selected) {
    const job = jobs[id],
      name = String(job.name || id);
    if (job.strategy || job.uses || /\$\{\{/.test(name + String(data.name)))
      exclusive = true;
    const base = actContainerName(
      "act",
      `${data.name || request.workflowPath.split("/").at(-1)}/${name}`,
    );
    namespace.add(`container:${base}`);
    namespace.add(`volume:${base}`);
    namespace.add(`volume:${base}-env`);
    if (job.services) {
      exclusive = true;
    } // Service/action child resources are not reliably run-labeled in stock Act.
    const container =
      typeof job.container === "string" ? job.container : job.container?.image;
    if (container) {
      images.set(`container:${id}`, container);
      if (typeof job.container === "object" && job.container.options) {
        managedConflict = true;
        exclusive = true;
      }
    }
    const labels = Array.isArray(job["runs-on"])
      ? job["runs-on"]
      : [job["runs-on"]];
    if (!container)
      for (const label of labels)
        if (typeof label === "string") images.set(label, "");
    for (const step of job.steps || [])
      if (step.run && /\b(?:docker|podman)\b/.test(step.run)) exclusive = true;
    for (const step of job.steps || [])
      if (step.uses) {
        actions.push(step.uses);
        if (!/^actions\/checkout@/.test(step.uses)) toolcache = true;
      }
  }
  return {
    data,
    selected,
    namespace: [...namespace],
    exclusive,
    toolcache,
    managedConflict,
    images,
    actions,
    secretNames: [...secretNames],
    hash: createHash("sha256").update(content).digest("hex"),
  };
}
export async function safeLocalAction(base: string, reference: string) {
  const root = await realpath(base),
    path = await realpath(resolve(root, reference));
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new AppError(
      "ACTION_PATH_ESCAPE",
      "A local action points outside its repository.",
    );
  return path;
}
