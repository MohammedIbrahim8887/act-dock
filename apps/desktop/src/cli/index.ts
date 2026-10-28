#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { call, request, ensureRunner, isAlive } from "../runner/client";
import { serve } from "../runner/service";
import { startMcp } from "./mcp";
import { errorMessage, AppError, runRequestSchema } from "../shared/contracts";
const help = `Act Dock — local GitHub Actions\n\nprojects list | projects add /absolute/path\nworkflows list PROJECT_ID\nrun --project ID --workflow .github/workflows/ci.yml --event push [--job ID]\n    [--input NAME=VALUE] [--event-file PATH] [--env-file PATH]\n    [--var-file PATH] [--secret-file PATH] [--architecture auto|linux/amd64|linux/arm64] [--config execution.json]\n    [--idempotency-key KEY]\nruns list [--project ID] [--cursor 0] [--limit 100] [--status STATE] [--source desktop|cli|mcp] [--search TEXT] [--since ISO_DATE]\nstatus RUN_ID | logs RUN_ID [--follow] [--cursor 0] | cancel RUN_ID\nimages list|inspect REF|pull REF|refresh REF|operations|cancel ID [--platform linux/arm64]\ncache list|clear ID|refresh PROJECT [--project ID]\nsecrets list|put|delete NAME|preview|import [--project ID] (write/import JSON via stdin)\nevents [RUN_ID] [--cursor 0] [--wait 10000] | metrics RUN_ID\ndoctor | doctor preflight (RunRequest JSON via stdin)\nrunner start | runner stop | runner status\nmcp\n\nResponses are JSON. MCP reserves stdout for protocol messages.`;
async function main() {
  const { positionals: a, values: v } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      "secrets-stdin": { type: "boolean" },
      config: { type: "string" },
      platform: { type: "string" },
      wait: { type: "string" },
      project: { type: "string" },
      workflow: { type: "string" },
      event: { type: "string" },
      job: { type: "string" },
      input: { type: "string", multiple: true },
      "event-file": { type: "string" },
      "env-file": { type: "string" },
      "var-file": { type: "string" },
      "secret-file": { type: "string" },
      architecture: { type: "string" },
      "idempotency-key": { type: "string" },
      follow: { type: "boolean" },
      cursor: { type: "string" },
      limit: { type: "string" },
      status: { type: "string" },
      source: { type: "string" },
      search: { type: "string" },
      since: { type: "string" },
      help: { type: "boolean" },
    },
  });
  const print = (d: unknown) => console.log(JSON.stringify(d, null, 2));
  if (v.help || !a.length) {
    console.log(help);
    return;
  }
  if (a[0] === "serve") {
    await serve();
    return;
  }
  if (a[0] === "mcp") {
    await startMcp();
    return;
  }
  if (a[0] === "runner") {
    if (a[1] === "status") {
      print({ running: await isAlive() });
      return;
    }
    if (a[1] === "start") {
      await ensureRunner();
      print({ running: true });
      return;
    }
    if (a[1] === "stop") {
      if (await isAlive()) await request("stop");
      print({ stopped: true });
      return;
    }
  }
  if (a[0] === "projects" && a[1] === "list")
    return print(await call("list_projects"));
  if (a[0] === "projects" && a[1] === "add")
    return print(await call("add_project", { path: a[2] }));
  if (a[0] === "workflows" && a[1] === "list")
    return print(await call("list_workflows", { projectId: a[2] }));
  if (a[0] === "runs" && a[1] === "list")
    return print(
      await call("list_runs", {
        projectId: v.project,
        state: v.status,
        source: v.source,
        query: v.search,
        since: v.since,
        cursor: Number(v.cursor || 0),
        limit: Number(v.limit || 100),
      }),
    );
  const jsonInput = async () => JSON.parse(await Bun.stdin.text());
  if (a[0] === "capabilities") return print(await call("get_capabilities"));
  if (a[0] === "images") {
    if (a[1] === "list")
      return print(await call("list_runner_images", { projectId: v.project }));
    if (["inspect", "pull", "refresh"].includes(a[1]))
      return print(
        await call(a[1] === "inspect" ? "inspect_image" : "pull_image", {
          reference: a[2],
          architecture: v.platform || "auto",
        }),
      );
    if (a[1] === "operations")
      return print(await call("list_image_operations"));
    if (a[1] === "cancel")
      return print(await call("cancel_image_pull", { operationId: a[2] }));
  }
  if (a[0] === "cache") {
    if (a[1] === "list")
      return print(await call("list_caches", { projectId: v.project }));
    if (a[1] === "clear")
      return print(await call("clear_cache", { cacheId: a[2] }));
    if (a[1] === "refresh")
      return print(
        await call("refresh_project_cache", { projectId: v.project || a[2] }),
      );
  }
  if (a[0] === "secrets") {
    if (a[1] === "list")
      return print(
        await call("list_project_secrets", { projectId: v.project || a[2] }),
      );
    if (a[1] === "delete")
      return print(
        await call("delete_project_secret", {
          projectId: v.project,
          name: a[2],
        }),
      );
    // Secret values are accepted only via stdin; never include them in shell arguments.
    if (a[1] === "put")
      return print(
        await call("put_project_secret", {
          ...(await jsonInput()),
          projectId: v.project,
        }),
      );
    if (a[1] === "preview")
      return print(
        await call("preview_import", {
          ...(await jsonInput()),
          projectId: v.project,
        }),
      );
    if (a[1] === "import")
      return print(
        await call("import_project_configuration", {
          ...(await jsonInput()),
          projectId: v.project,
        }),
      );
    if (a[1] === "resupply")
      return print(
        await call("supply_run_secrets", {
          runId: a[2],
          values: await jsonInput(),
        }),
      );
  }
  if (a[0] === "events")
    return print(
      await call("read_events", {
        cursor: Number(v.cursor || 0),
        limit: Number(v.limit || 500),
        waitMs: Number(v.wait || 0),
        runIds: a[1] ? [a[1]] : undefined,
      }),
    );
  if (a[0] === "metrics")
    return print(
      await call("get_run_metrics", {
        runId: a[1],
        cursor: Number(v.cursor || 0),
        limit: Number(v.limit || 500),
      }),
    );
  if (a[0] === "doctor" && a[1] === "preflight")
    return print(await call("preflight_run", { request: await jsonInput() }));
  if (a[0] === "run") {
    const inputs = Object.fromEntries(
      (v.input || []).map((i) => {
        const index = i.indexOf("=");
        if (index < 1)
          throw new AppError("INVALID_INPUT", "Use --input NAME=VALUE.");
        return [i.slice(0, index), i.slice(index + 1)];
      }),
    );
    const r = runRequestSchema.parse({
      execution: v.config
        ? JSON.parse(await Bun.file(v.config).text())
        : undefined,
      projectId: v.project,
      workflowPath: v.workflow,
      event: v.event || "push",
      jobId: v.job,
      inputs,
      eventFile: v["event-file"],
      envFile: v["env-file"],
      varFile: v["var-file"],
      secretFile: v["secret-file"],
      architecture: v.architecture || "auto",
      idempotencyKey: v["idempotency-key"],
    });
    return print(
      await call("run_pipeline", {
        ...r,
        secretOverrides: v["secrets-stdin"] ? await jsonInput() : undefined,
      }),
    );
  }
  if (a[0] === "status") return print(await call("get_run", { runId: a[1] }));
  if (a[0] === "doctor") return print(await call("check_health"));
  if (a[0] === "cancel")
    return print(await call("cancel_run", { runId: a[1] }));
  if (a[0] === "logs") {
    let cursor = Number(v.cursor || 0);
    let eventCursor = (await call("get_runner_snapshot")).cursor;
    do {
      const page = await call("get_run_logs", { runId: a[1], cursor });
      for (const e of page.entries)
        console.log(
          v.follow ? `[${e.stream}] ${e.message}` : JSON.stringify(e),
        );
      cursor = page.nextCursor;
      if (page.end || !v.follow) break;
      const events = await call("read_events", {
        cursor: eventCursor,
        runIds: [a[1]],
        waitMs: 10000,
      });
      eventCursor = events.nextCursor;
    } while (true);
    return;
  }
  throw new AppError("UNKNOWN_COMMAND", help);
}
if (import.meta.main)
  main().catch((e) => {
    console.error(
      JSON.stringify({
        code: e instanceof AppError ? e.code : "ERROR",
        message:
          e instanceof AppError
            ? errorMessage(e)
            : "Command failed. Check JSON input and System health.",
      }),
    );
    process.exitCode = 1;
  });
