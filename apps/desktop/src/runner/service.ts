import { basename } from "node:path";
import {
  unlinkSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { z } from "zod";
import {
  AppError,
  methods,
  type Method,
  type Run,
} from "../shared/contracts";
import { dataDir, preparePaths, socketPath } from "./paths";
import { Store } from "./store";
import { Scheduler, health } from "./process";
import { checkHealth, fixHealth } from "./doctor";
import { canonicalProject, discover, validateRun } from "./workflows";
import { invalidateHealth } from "./executor/act";
import { imageCatalog } from "./images";
import { preflightRun } from "./preflight";
import { resolveExecution } from "./execution-config";
import { readEvents } from "./events";
import { browseFolders } from "./folders";
import { setLogin } from "./login";
import { listenLocal } from "./transport";
export async function serve() {
  preparePaths();
  const lock = dataDir + "/runner.lock";
  let owned = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      owned = true;
      break;
    } catch {
      const pid = Number(readFileSync(lock, "utf8"));
      // Another process can observe the lock between creation and PID write.
      if (!pid && Date.now() - statSync(lock).mtimeMs < 5000) return;
      try {
        process.kill(pid, 0);
        // Container PID 1 may leave a killed daemon as a zombie. Such a PID
        // still passes kill(pid, 0), but cannot own a functioning service.
        if (process.platform === "linux") {
          const status = readFileSync(`/proc/${pid}/stat`, "utf8");
          if (status.slice(status.lastIndexOf(")") + 2).startsWith("Z "))
            throw new Error("Previous runner exited");
        }
        return;
      } catch {
        try {
          unlinkSync(lock);
        } catch {}
      }
    }
  }
  if (!owned)
    throw new AppError(
      "RUNNER_BUSY",
      "Another runner is starting. Retry shortly.",
    );
  try {
    unlinkSync(socketPath);
  } catch {}
  const store = new Store(dataDir);
  const scheduler = new Scheduler(store);
  let server: Awaited<ReturnType<typeof listenLocal>>;
  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    await scheduler.stop();
    await server.stop(true);
    store.close();
    try {
      unlinkSync(socketPath);
      unlinkSync(lock);
    } catch {}
  }
  async function dispatch(method: Method, raw: unknown, source: Run["source"]) {
    // Parsing is repeated per method to retain schema-inferred types.
    switch (method) {
      case "get_capabilities":
        return { apiVersion: 2, engineVersion: (await health(store)).act.message, features: ["execution-config", "events", "images", "caches", "vault", "preflight", "concurrency", "metrics"] };
      case "get_runner_snapshot":
        return store.db.transaction(() => ({ runs: store.listRuns({},0,200), cursor: store.eventCursor() }))();
      case "read_events":
        return readEvents(store, methods.read_events.parse(raw));
      case "patch_settings": {
        const patch = methods.patch_settings.parse(raw);
        const previous = store.settings();
        const next = { ...previous, ...patch, executionDefaults: { ...previous.executionDefaults, ...patch.executionDefaults } };
        if (next.startAtLogin !== previous.startAtLogin) await setLogin(next.startAtLogin);
        return store.saveSettings(next);
      }
      case "preflight_run": {
        const p=methods.preflight_run.parse(raw);
        const report=await preflightRun(store,scheduler.images,p.request);
        try { await scheduler.secrets.selected(p.request.projectId,report.snapshot.secretNames); }
        catch(e){ report.issues.push({code:e instanceof AppError?e.code:"VAULT_UNAVAILABLE",message:e instanceof AppError?e.message:"The vault could not be checked.",severity:"error",recoverable:true});report.ready=false; }
        return report;
      }
      case "list_runner_images": {
        const p=methods.list_runner_images.parse(raw),catalog=imageCatalog();
        if(p.projectId){const project=store.project(p.projectId);for(const [label,reference]of Object.entries(project.defaults.execution?.runnerMappings||{}))catalog.push({label,reference,tier:"custom" as "medium",legacy:false});}
        return catalog;
      }
      case "inspect_image": {const p=methods.inspect_image.parse(raw);return scheduler.images.resolve(p.reference,await scheduler.images.platform(p.architecture),"if-missing",false);}
      case "pull_image": {const p=methods.pull_image.parse(raw);return scheduler.images.pull(p.reference,await scheduler.images.platform(p.architecture));}
      case "cancel_image_pull": return scheduler.images.cancel(methods.cancel_image_pull.parse(raw).operationId);
      case "list_image_operations": return scheduler.images.list();
      case "list_caches": return scheduler.caches.list(methods.list_caches.parse(raw).projectId);
      case "clear_cache": return scheduler.caches.clear(methods.clear_cache.parse(raw).cacheId);
      case "refresh_project_cache": return scheduler.caches.refresh(methods.refresh_project_cache.parse(raw).projectId);
      case "list_project_secrets": return scheduler.secrets.list(methods.list_project_secrets.parse(raw).projectId);
      case "put_project_secret": {const p=methods.put_project_secret.parse(raw);return scheduler.secrets.put(p.projectId,p.name,p.value,p.granted);}
      case "delete_project_secret": {const p=methods.delete_project_secret.parse(raw);return scheduler.secrets.delete(p.projectId,p.name);}
      case "preview_import": {const p=methods.preview_import.parse(raw);return scheduler.secrets.preview(p.projectId,p.path,p.target);}
      case "import_project_configuration": {const p=methods.import_project_configuration.parse(raw);return scheduler.secrets.import(p.projectId,p.path,p.target,p.names,p.overwrite);}
      case "supply_run_secrets": {
        const p=methods.supply_run_secrets.parse(raw),run=store.run(p.runId);
        if(run.state!=="queued")throw new AppError("RUN_NOT_QUEUED","Only queued runs accept replacement secret input.");
        if(JSON.stringify(Object.keys(p.values).sort())!==JSON.stringify([...(run.ephemeralSecretNames||[])].sort()))throw new AppError("SECRET_NAMES","Resupply exactly the secret names required by this run.");
        scheduler.secrets.ephemeral.set(run.id,p.values);
        store.putRun({...run,needsSecretInput:false,queueReason:undefined,overrideFingerprint:await scheduler.secrets.fingerprint(p.values)});
        void scheduler.pump();return null;
      }
      case "get_run_metrics": {
        const p=methods.get_run_metrics.parse(raw);store.run(p.runId);
        const rows=store.db.query("SELECT cursor,data FROM metrics WHERE run_id=? AND cursor>? ORDER BY cursor LIMIT ?").all(p.runId,p.cursor,p.limit) as {cursor:number;data:string}[];
        return {entries:rows.map(r=>({...JSON.parse(r.data),cursor:r.cursor})),nextCursor:rows.at(-1)?.cursor??p.cursor};
      }
      case "list_projects":
        methods[method].parse(raw);
        return store.projects();
      case "add_project": {
        const p = methods[method].parse(raw);
        const path = await canonicalProject(p.path);
        const existing = store.projects().find((p) => p.path === path);
        return (
          existing ||
          store.putProject({
            id: crypto.randomUUID(),
            path,
            name: basename(path),
            defaults: {},
          })
        );
      }
      case "remove_project": {
        const p = methods[method].parse(raw);
        store.removeProject(p.projectId);
        return null;
      }
      case "save_defaults": {
        const p = methods[method].parse(raw);
        return store.putProject({
          ...store.project(p.projectId),
          defaults: p.defaults,
        });
      }
      case "list_workflows": {
        const p = methods[method].parse(raw);
        return discover(store.project(p.projectId));
      }
      case "run_pipeline": {
        const { secretOverrides, ...p } = methods.run_pipeline.parse(raw);
        const fingerprint=secretOverrides&&Object.keys(secretOverrides).length?await scheduler.secrets.fingerprint(secretOverrides):undefined;
        if(p.idempotencyKey&&store.idempotent(p.idempotencyKey))return scheduler.enqueue(p,source,secretOverrides,fingerprint);
        const project=store.project(p.projectId),snapshot=resolveExecution(project,p,store.settings());
        await validateRun(project,{...p,execution:snapshot.options});
        return scheduler.enqueue(p, source, secretOverrides, fingerprint);
      }
      case "browse_folders":
        return browseFolders(methods[method].parse(raw));
      case "get_run_history":
        return store.history(methods[method].parse(raw));
      case "list_runs": {
        const p = methods[method].parse(raw);
        return store.listRuns(p, p.cursor, p.limit);
      }
      case "get_run":
        return store.run(methods[method].parse(raw).runId);
      case "get_run_logs": {
        const p = methods[method].parse(raw);
        return scheduler.logs(p.runId, p.cursor, p.limit);
      }
      case "cancel_run":
        return scheduler.cancel(methods[method].parse(raw).runId);
      case "get_settings":
        return store.settings();
      case "update_settings": {
        const p = methods[method].parse({ ...store.settings(), ...(raw as object) });
        if (p.startAtLogin !== store.settings().startAtLogin)
          await setLogin(p.startAtLogin);
        return store.saveSettings(p);
      }
      case "health":
        return health(store);
      case "check_health":
        return checkHealth(store,{images:scheduler.images});
      case "fix_health": {
        const {action}=methods.fix_health.parse(raw);invalidateHealth(store);
        if(action==="pull_image"){
          const reference=store.settings().executionDefaults?.runnerMappings?.["ubuntu-latest"]||"catthehacker/ubuntu:act-24.04";
          scheduler.images.pull(reference,await scheduler.images.platform("auto"));
          return {message:"Downloading "+reference};
        }
        const result=await fixHealth(store,action);void scheduler.pump();return result;
      }
      case "stop":
        setTimeout(() => void shutdown(), 50);
        return null;
    }
  }
  server = await listenLocal(async (requestBody) => {
      try {
        const body = z
          .object({
            method: z.enum(Object.keys(methods) as [Method, ...Method[]]),
            params: z.unknown().default({}),
            source: z.enum(["desktop", "cli", "mcp"]).default("cli"),
          })
          .parse(requestBody);
        const data = await dispatch(body.method, body.params, body.source);
        return Response.json({ ok: true, data });
      } catch (e) {
        return Response.json(
          {
            ok: false,
            error: {
              code:
                e instanceof AppError
                  ? e.code
                  : e instanceof z.ZodError
                    ? "VALIDATION_ERROR"
                    : (e as NodeJS.ErrnoException).code || "INTERNAL_ERROR",
              message: e instanceof AppError ? e.message : "The runner could not complete the request. Check the selected configuration and System health.",
            },
          },
          { status: 400 },
        );
      }
  });
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  void scheduler.pump();
  return { store, scheduler, shutdown };
}
