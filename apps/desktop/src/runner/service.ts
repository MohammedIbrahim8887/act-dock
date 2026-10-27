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
  errorMessage,
  methods,
  type Method,
  type Run,
} from "../shared/contracts";
import { dataDir, preparePaths, socketPath } from "./paths";
import { Store } from "./store";
import { Scheduler, health } from "./process";
import { checkHealth, fixHealth } from "./doctor";
import { canonicalProject, discover, validateRun } from "./workflows";
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
        const p = methods[method].parse(raw);
        if (p.idempotencyKey && store.idempotent(p.idempotencyKey))
          return scheduler.enqueue(p, source);
        await validateRun(store.project(p.projectId), p);
        return scheduler.enqueue(p, source);
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
        const p = methods[method].parse(raw);
        if (p.startAtLogin !== store.settings().startAtLogin)
          await setLogin(p.startAtLogin);
        return store.saveSettings(p);
      }
      case "health":
        return health(store);
      case "check_health":
        return checkHealth(store);
      case "fix_health":
        return fixHealth(store, methods[method].parse(raw).action);
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
              message: errorMessage(e),
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
