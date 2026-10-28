import { test, expect } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, mkdir, writeFile, chmod, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  ServiceReply,
  Run,
  Project,
  LogPage,
  HistoryPage,
  FolderListing,
} from "../src/shared/contracts";
const cli = resolve(import.meta.dir, "../src/cli/index.ts");
const executable = process.env.ACT_DOCK_TEST_EXECUTABLE || process.execPath;
const prefix = process.env.ACT_DOCK_TEST_EXECUTABLE ? [] : [cli];
test("MCP and CLI share one on-demand service, runs survive client exit, and restart preserves results", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ad-svc-"));
  const env = { ...process.env, ACT_DOCK_DATA_DIR: dir };
  let client: Client | undefined;
  async function rpc(method: string, params: unknown = {}) {
    const r = await fetch("http://localhost/rpc", {
      unix: join(dir, "runner.sock"),
      method: "POST",
      headers: {
        Authorization:
          "Bearer " + (await Bun.file(join(dir, "runner.key")).text()).trim(),
      },
      body: JSON.stringify({ method, params }),
    });
    const result = (await r.json()) as ServiceReply;
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }
  async function command(...args: string[]) {
    const p = Bun.spawn([executable, ...prefix, ...args], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(p.stdout).text();
    const error = await new Response(p.stderr).text();
    const exitCode = await p.exited;
    if (exitCode !== 0)
      throw new Error(error || output || `CLI exited ${exitCode}`);
    expect(exitCode).toBe(0);
    return JSON.parse(output || error);
  }
  try {
    await mkdir(join(dir, "project/.github/workflows"), { recursive: true });
    await writeFile(
      join(dir, "project/.github/workflows/ci.yml"),
      "name: Integration\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo test\n",
    );
    const act = join(dir, "fake-act"),
      docker = join(dir, "fake-docker");
    await writeFile(
      act,
      `#!${process.execPath}\nif(process.argv.includes('--version')){console.log('fake');process.exit(0)}console.log('{"msg":"integration output"}');await Bun.sleep(700);\n`,
    );
    await writeFile(
      docker,
      `#!${process.execPath}\nif(process.argv.includes('info'))console.log('fake');\n`,
    );
    await chmod(act, 0o700);
    await chmod(docker, 0o700);
    await Promise.all([command("runner", "start"), command("runner", "start")]);
    expect((await stat(join(dir, "runner.sock"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, "runner.key"))).mode & 0o777).toBe(0o600);
    const anonymous = await fetch("http://localhost/rpc", {
      unix: join(dir, "runner.sock"),
      method: "POST",
      body: JSON.stringify({ method: "get_settings" }),
    });
    expect(anonymous.status).toBe(403);
    await rpc("update_settings", {
      theme: "system",
      startAtLogin: false,
      actPath: act,
      dockerPath: docker,
    });
    client = new Client({ name: "integration-test", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: executable,
        args: [...prefix, "mcp"],
        env: env as Record<string, string>,
      }),
    );
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "get_capabilities",
        "preflight_run",
        "read_events",
        "list_project_secrets",
        "get_run_metrics",
      ]),
    );
    expect(list.tools.map((t) => t.name)).not.toContain("get_secret_value");
    expect(list.tools.map((t) => t.name)).toContain("run_pipeline");
    const invoke = async <T>(
      name: string,
      args: Record<string, unknown>,
    ): Promise<T> => {
      const r = await client!.callTool({ name, arguments: args });
      expect(r.isError).not.toBe(true);
      return (r.structuredContent as { result: T }).result;
    };
    const report = await invoke<{
      overall: string;
      checks: { id: string; status: string }[];
    }>("check_health", {});
    expect(["ready", "attention", "blocked"]).toContain(report.overall);
    expect(report.checks.find((c) => c.id === "act")?.status).toBe("ok");
    const p = await invoke<Project>("add_project", {
      path: join(dir, "project"),
    });
    await rpc("patch_settings", {
      executionDefaults: { imagePullPolicy: "never" },
    });
    const config = (await rpc("get_execution_config", { projectId: p.id })) as {
      inherited: { options: { imagePullPolicy: string } };
      effective: { options: { imagePullPolicy: string } };
    };
    expect(config.inherited.options.imagePullPolicy).toBe("never");
    expect(config.effective.options.imagePullPolicy).toBe("never");
    expect(((await rpc("get_settings")) as { actPath: string }).actPath).toBe(
      act,
    );
    await rpc("patch_settings", {
      executionDefaults: { imagePullPolicy: "if-missing" },
    });
    expect(await invoke("list_workflows", { projectId: p.id })).toHaveLength(1);
    const r = await invoke<Run>("run_pipeline", {
      projectId: p.id,
      workflowPath: ".github/workflows/ci.yml",
      event: "push",
      idempotencyKey: "integration",
    });
    const duplicate = await invoke<Run>("run_pipeline", {
      projectId: p.id,
      workflowPath: ".github/workflows/ci.yml",
      event: "push",
      idempotencyKey: "integration",
    });
    expect(duplicate.id).toBe(r.id);
    // Closing the agent/desktop client must not own or cancel execution.
    await client.close();
    client = undefined;
    let run: Run;
    const deadline = Date.now() + 10000;
    do {
      run = (await rpc("get_run", { runId: r.id })) as Run;
      if (Date.now() > deadline) throw new Error("run timed out");
      await Bun.sleep(100);
    } while (["queued", "running"].includes(run.state));
    expect(run.state).toBe("succeeded");
    expect(
      ((await rpc("get_run_logs", { runId: r.id })) as LogPage).entries[0]
        .message,
    ).toBe("integration output");
    expect((await command("status", r.id)).id).toBe(r.id);
    const folders = (await rpc("browse_folders", {
      path: p.path,
    })) as FolderListing;
    expect(folders.path).toBe(p.path);
    expect(folders.hasWorkflows).toBe(true);
    const history = (await rpc("get_run_history", {
      source: "mcp",
      state: "succeeded",
      page: 1,
      pageSize: 1,
    })) as HistoryPage;
    expect(history.total).toBe(1);
    expect(history.runs[0].id).toBe(r.id);
    expect(
      (
        await command(
          "runs",
          "list",
          "--source",
          "mcp",
          "--status",
          "succeeded",
          "--search",
          "ci.yml",
        )
      )[0].id,
    ).toBe(r.id);

    await rpc("stop");
    await Bun.sleep(300);
    await command("runner", "start");
    expect(((await rpc("get_run", { runId: r.id })) as Run).state).toBe(
      "succeeded",
    );
    // Reconnect via MCP and exercise cursor reads and cancellation.
    client = new Client({ name: "integration-test", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: executable,
        args: [...prefix, "mcp"],
        env: env as Record<string, string>,
      }),
    );
    const logs = await invoke<LogPage>("get_run_logs", {
      runId: r.id,
      cursor: 0,
      limit: 1,
    });
    expect(logs.nextCursor).toBe(1);
    const queued = await invoke<Run>("run_pipeline", {
      projectId: p.id,
      workflowPath: ".github/workflows/ci.yml",
      event: "push",
    });
    await invoke("cancel_run", { runId: queued.id });
    const bad = await client.callTool({
      name: "run_pipeline",
      arguments: {
        projectId: p.id,
        workflowPath: "../../outside.yml",
        event: "push",
      },
    });
    expect(bad.isError).toBe(true);
  } finally {
    await client?.close();
    await rpc("stop").catch(() => {});
    await Bun.sleep(400);
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
