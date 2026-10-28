import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { defaultExecution, executionOptionsSchema, imageReferenceSchema, type ExecutionOptions, type ExecutionSnapshot, type Project, type RunRequest, type Settings } from "../shared/contracts";

export function actrcPaths(projectPath: string, env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  const config = process.platform === "darwin" ? join(home,"Library/Application Support") : process.platform === "win32" ? env.LOCALAPPDATA || join(home,"AppData/Local") : env.XDG_CONFIG_HOME || join(home,".config");
  return [join(config,"act/actrc"), join(home,".actrc"), join(projectPath,".actrc")];
}
export function managedActrc(path: string, env = process.env): { options: ExecutionOptions; containerOptions: string } {
  let content = "";
  try { content = readFileSync(path,"utf8"); } catch { return { options: {}, containerOptions: "" }; }
  const options: ExecutionOptions = {};
  let containerOptions = "";
  for (const line of content.split(/\r?\n/)) {
    const expanded = line.trim().replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_,a,b) => env[a || b] || "");
    const match = expanded.match(/^(--[\w-]+|-[Pbrp])(?:=|\s+)?(.*)$/);
    if (!match) continue;
    const [,flag,value] = match;
    if (["-P","--platform"].includes(flag)) {
      const index = value.indexOf("=");
      const label = value.slice(0,index), image = value.slice(index+1);
      if (index > 0 && /^[\w.-]+$/.test(label) && imageReferenceSchema.safeParse(image).success) options.runnerMappings = {...options.runnerMappings,[label]:image};
    } else if (["-p","--pull"].includes(flag)) options.imagePullPolicy = value === "false" ? "if-missing" : "always";
    else if (["-b","--bind"].includes(flag)) options.workspaceMode = value === "false" ? "copy" : "bind";
    else if (flag === "--action-offline-mode" && value !== "false") options.actionCachePolicy = "cache-first";
    else if (flag === "--concurrent-jobs" && Number(value) >= 1 && Number(value) <= 64) options.concurrentJobs = Number(value);
    else if (flag === "--container-options") containerOptions = value;
  }
  return { options, containerOptions };
}
export function resolveExecution(project: Project, request: RunRequest, settings: Settings, paths = actrcPaths(project.path)): ExecutionSnapshot {
  let options = structuredClone(defaultExecution);
  const provenance: Record<string,string> = Object.fromEntries(Object.keys(options).map(k => [k,"Built-in default"]));
  const apply = (raw: ExecutionOptions | undefined, source: string) => {
    if (!raw) return;
    const layer = executionOptionsSchema.parse(raw);
    for (const [key,value] of Object.entries(layer)) if (value !== undefined) {
      if (key === "runnerMappings") {
        for (const [label,image] of Object.entries(value)) {
          options.runnerMappings[label] = image as string;
          provenance[`runnerMappings.${label}`] = source;
        }
      } else {
        options = { ...options, [key]: value };
        provenance[key] = source;
      }
    }
  };
  apply(settings.executionDefaults,"Global settings");
  for (const path of paths) apply(managedActrc(path).options,`Config: ${path}`);
  apply(project.defaults.execution,"Project defaults");
  apply(request.execution,"Run override");
  return { options, provenance, images: [], workflowHashes: {}, secretNames: [...options.secretNames] };
}
