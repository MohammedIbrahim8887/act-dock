import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative, isAbsolute } from "node:path";
import { parseDocument } from "yaml";
import {
  AppError,
  imageReferenceSchema,
  defaultMappings,
  type Project,
  type RunRequest,
} from "../shared/contracts";

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
      container?:
        | string
        | { image?: string; options?: string; volumes?: string[] };
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
    .replace(/[^a-zA-Z0-9]/gu, "-")
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
  let privateNames = false;
  const services: { id: string; image: string }[] = [];
  const images = new Map<string, string>(),
    actions: string[] = [],
    secretNames = new Set<string>();
  const content = await readFile(path, "utf8");
  for (const m of content.matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g))
    secretNames.add(m[1].toUpperCase());
  for (const id of selected) {
    const job = jobs[id],
      name = String(job.name || id);
    if (job.uses) {
      actions.push(job.uses);
      toolcache = true;
    }
    if (job.uses || /\$\{\{/.test(name + String(data.name)))
      privateNames = true;
    if (job.uses || /\$\{\{/.test(name + String(data.name))) exclusive = true;
    const display = `${data.name || request.workflowPath.split("/").at(-1)}/${name}`;
    const bases = [actContainerName("act", display)];
    if (job.strategy) {
      const matrix = (job.strategy as { matrix?: unknown }).matrix;
      if (
        matrix &&
        typeof matrix === "object" &&
        !Array.isArray(matrix) &&
        !JSON.stringify(matrix).includes("${{")
      ) {
        const entries = Object.entries(matrix),
          axes = entries.filter(
            ([key]) => !["include", "exclude"].includes(key),
          );
        if (entries.every(([, value]) => Array.isArray(value))) {
          const count =
            axes.reduce(
              (total, [, value]) => total * (value as unknown[]).length,
              1,
            ) + ((matrix as { include?: unknown[] }).include?.length || 0);
          if (count <= 256)
            for (let index = 1; index <= count; index++)
              bases.push(actContainerName("act", display + "-" + index));
          else exclusive = true;
        } else exclusive = true;
      } else if (matrix) exclusive = true;
    }
    for (const base of bases) {
      namespace.add(`container:${base}`);
      namespace.add(`volume:${base}`);
      namespace.add(`volume:${base}-env`);
    }
    if (job.services) {
      for (const base of bases) namespace.add(`network:${base}-${id}-network`);
      for (const [serviceId, raw] of Object.entries(job.services)) {
        const spec = raw as {
            image?: unknown;
            options?: string;
            volumes?: string[];
            ports?: unknown[];
          },
          image = typeof raw === "string" ? raw : spec?.image;
        if (imageReferenceSchema.safeParse(image).success)
          services.push({ id: serviceId, image: image as string });
        for (const base of bases)
          namespace.add(`container:${actContainerName(base, serviceId)}`);
        if (spec?.volumes?.length) exclusive = true;
        if (spec?.options) {
          const flags = [
            ...spec.options.matchAll(/(?:^|\s)(--[a-z-]+|-[vp])(?=\s|=)/g),
          ].map((match) => match[1]);
          if (
            flags.some(
              (flag) =>
                !/^--health-(cmd|interval|timeout|retries|start-period|start-interval)$/.test(
                  flag,
                ),
            )
          )
            exclusive = true;
        }
        for (const port of spec?.ports || []) {
          if (typeof port !== "string") continue;
          if (port.includes("${{")) {
            exclusive = true;
            continue;
          }
          const parts = port.split(":");
          if (parts.length > 1) namespace.add(`host-port:${parts.at(-2)}`);
        }
      }
    }
    const container =
      typeof job.container === "string" ? job.container : job.container?.image;
    if (container) {
      images.set(`container:${id}`, container);
      if (typeof job.container === "object" && job.container.options) {
        managedConflict = true;
        exclusive = true;
        privateNames = true;
      }
    }
    if (typeof job.container === "object")
      for (const mount of job.container.volumes || []) {
        if (mount.includes("${{")) exclusive = true;
        else namespace.add(`writable-volume:${mount.split(":")[0]}`);
      }
    const labels = Array.isArray(job["runs-on"])
      ? job["runs-on"]
      : [job["runs-on"]];
    if (!container) {
      const mappings: Record<string, string> = {
        ...defaultMappings,
        ...request.execution?.runnerMappings,
      };
      const selectedLabel = labels.find(
        (label) => typeof label === "string" && mappings[label.toLowerCase()],
      );
      const label =
        selectedLabel ?? labels.find((label) => typeof label === "string");
      if (typeof label === "string") images.set(label.toLowerCase(), "");
    }
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
    services,
    privateNames,
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
