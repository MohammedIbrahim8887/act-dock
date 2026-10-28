import { APP_VERSION } from "../shared/version";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { methods, errorMessage, AppError } from "../shared/contracts";
import { call } from "../runner/client";
export async function startMcp() {
  const server = new McpServer({ name: "act-dock", version: APP_VERSION });
  const descriptions = {
    get_capabilities: "Read API and engine versions and supported managed execution features.",
    get_runner_snapshot: "Read current runs with a durable event cursor for race-free subscription.",
    preflight_run: "Inspect effective execution configuration, images, dependencies, cache and secret metadata before queuing. Does not execute a workflow.",
    list_runner_images: "List medium, full and project custom image presets.",
    inspect_image: "Inspect a platform-specific managed image without downloading it.",
    list_image_operations: "Read shared image preparation status.",
    pull_image: "Mutating: start a shared Docker image download for an explicit platform.",
    cancel_image_pull: "Mutating: cancel an image download shared by waiting consumers.",
    list_caches: "Read project action/package cache metadata and active leases.",
    clear_cache: "Mutating: clear an inactive app-owned cache; active caches cannot be removed.",
    refresh_project_cache: "Mutating: clear inactive project caches so later runs acquire fresh content.",
    list_project_secrets: "List names, grants and revisions of saved project secrets. Never returns secret values. Select granted names through run_pipeline.execution.secretNames.",
    read_events: "Read resumable durable progress events after a global cursor; wait up to 10 seconds. Does not affect execution lifetime.",
    get_run_metrics: "Read bounded container CPU and memory samples after a metrics cursor.",
    list_projects: "List saved local projects.",
    add_project:
      "Register an absolute local folder. Workflows run with your user permissions.",
    list_workflows: "Discover workflows, jobs, events and manual inputs.",
    run_pipeline:
      "Queue a local pipeline and immediately return a run ID. Use read_events and get_run_logs to follow it. Mutating: executes project workflows with local user permissions.",
    list_runs:
      "List local pipeline runs, newest first. Filter by project, state, source, literal query, or since (UTC ISO date). Filters apply before the cursor/limit. Cursor is an offset.",
    get_run: "Read run status and result.",
    get_run_logs:
      "Read a bounded log page after a cursor. Continue using nextCursor until end.",
    cancel_run: "Cancel a queued or running pipeline.",
    check_health:
      "Check whether this machine can run pipelines: Docker installed and running, act engine, job image, disk space, and GitHub access. Each check has a status and a suggested fix.",
  };
  for (const name of Object.keys(
    descriptions,
  ) as (keyof typeof descriptions)[]) {
    server.registerTool(
      name,
      { description: descriptions[name], inputSchema: methods[name].shape },
      async (params: Record<string, unknown>) => {
        try {
          const data = await call(name, params, "mcp");
          return {
            content: [{ type: "text" as const, text: JSON.stringify(data) }],
            structuredContent: { result: data },
          };
        } catch (e) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  code: e instanceof AppError ? e.code : "RUNNER_ERROR",
                  message: errorMessage(e),
                }),
              },
            ],
          };
        }
      },
    );
  }
  await server.connect(new StdioServerTransport());
}
