#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { call, request, ensureRunner, isAlive } from "../runner/client";
import { serve } from "../runner/service";
import { startMcp } from "./mcp";
import { errorMessage, AppError, runRequestSchema } from "../shared/contracts";
const help = `Act Dock — local GitHub Actions\n\nprojects list | projects add /absolute/path\nworkflows list PROJECT_ID\nrun --project ID --workflow .github/workflows/ci.yml --event push [--job ID]\n    [--input NAME=VALUE] [--event-file PATH] [--env-file PATH]\n    [--var-file PATH] [--secret-file PATH] [--architecture auto|linux/amd64]\n    [--idempotency-key KEY]\nruns list [--project ID] [--cursor 0] [--limit 100] [--status STATE] [--source desktop|cli|mcp] [--search TEXT] [--since ISO_DATE]\nstatus RUN_ID | logs RUN_ID [--follow] [--cursor 0] | cancel RUN_ID\nrunner start | runner stop | runner status\nmcp\n\nResponses are JSON. MCP reserves stdout for protocol messages.`;
async function main() {
  const { positionals: a, values: v } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
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
    return print(await call("run_pipeline", r));
  }
  if (a[0] === "status") return print(await call("get_run", { runId: a[1] }));
  if (a[0] === "cancel")
    return print(await call("cancel_run", { runId: a[1] }));
  if (a[0] === "logs") {
    let cursor = Number(v.cursor || 0);
    do {
      const page = await call("get_run_logs", { runId: a[1], cursor });
      for (const e of page.entries)
        console.log(
          v.follow ? `[${e.stream}] ${e.message}` : JSON.stringify(e),
        );
      cursor = page.nextCursor;
      if (page.end || !v.follow) break;
      await Bun.sleep(500);
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
        message: errorMessage(e),
      }),
    );
    process.exitCode = 1;
  });
