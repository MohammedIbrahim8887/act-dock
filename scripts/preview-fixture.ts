// Isolated, explicitly labeled UI fixture. Never touches your projects or production database.
import { mkdtemp, mkdir, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "ad-preview-"));
process.env.ACT_DOCK_DATA_DIR = dir;
const { serve } = await import("../src/runner/service");
const fixture = join(dir, "workspace/act-dock-demo");
await mkdir(join(fixture, ".github/workflows"), { recursive: true });
const workflow = (name: string, steps: string) =>
  `name: ${name}\non:\n  push:\n  pull_request:\n  workflow_dispatch:\n    inputs:\n      environment:\n        description: Target environment for local checks\n        type: choice\n        default: development\n        options: [development, staging]\njobs:\n  lint:\n    name: Lint & typecheck\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${steps}\n  test:\n    name: Unit tests\n    needs: lint\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo test\n  build:\n    name: Production build\n    needs: test\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo build\n`;
await writeFile(
  join(fixture, ".github/workflows/ci.yml"),
  workflow("Continuous integration", "lint"),
);
await writeFile(
  join(fixture, ".github/workflows/release.yml"),
  workflow("Release checks", "release"),
);
await writeFile(
  join(fixture, ".github/workflows/security.yml"),
  workflow("Dependency audit", "audit"),
);
const act = join(dir, "fake-act"),
  docker = join(dir, "fake-docker");
await writeFile(
  act,
  `#!${process.execPath}\nif(process.argv.includes('--version')){console.log('act fixture (simulated)');process.exit(0)}\nconst lines=['[fixture] Simulated output for interface review','Preparing local workflow','Using catthehacker/ubuntu:act-latest','Checkout current working files','Run bun install --frozen-lockfile','Dependencies are up to date','Run bun run typecheck','TypeScript: no errors','Run bun test','✓ workflow discovery (4 tests)','✓ process scheduler (5 tests)','✓ MCP integration (3 tests)','12 passed, 0 failed','Run bun run build','Build completed successfully','Workflow finished'];for(const msg of lines){console.log(JSON.stringify({msg,jobID:'test'}));await Bun.sleep(100)}\n`,
);
await writeFile(
  docker,
  `#!${process.execPath}\nif(process.argv.includes('info'))console.log('Fixture Docker (simulated)');\n`,
);
await chmod(act, 0o700);
await chmod(docker, 0o700);
const { store, scheduler } = (await serve()) || {};
if (!store || !scheduler) throw new Error("Fixture runner unavailable");
store.saveSettings({ ...store.settings(), actPath: act, dockerPath: docker });
const project = store.putProject({
  id: "fixture",
  path: fixture,
  name: "act-dock-demo",
  defaults: {},
});
if (!process.argv.includes("--history"))
  scheduler.enqueue(
    {
      projectId: project.id,
      workflowPath: ".github/workflows/ci.yml",
      event: "push",
      inputs: {},
      architecture: "auto",
    },
    "desktop",
  );

if (process.argv.includes("--history")) {
  const names = [
    "act-dock-demo",
    "web-client",
    "api-service",
    "archived-tools",
  ];
  const projects = [project];
  for (const name of names.slice(1, 3)) {
    const path = join(dir, "workspace", name);
    await mkdir(join(path, ".github/workflows"), { recursive: true });
    await writeFile(
      join(path, ".github/workflows/ci.yml"),
      workflow("Continuous integration", "test"),
    );
    projects.push(store.putProject({ id: name, path, name, defaults: {} }));
  }
  for (let i = 0; i < 67; i++) {
    const index = i % 4;
    const p = projects[index];
    const createdAt = new Date(Date.now() - i * 4 * 3600000).toISOString();
    const state = (
      ["succeeded", "failed", "succeeded", "cancelled", "interrupted"] as const
    )[i % 5];
    const source = (["desktop", "mcp", "cli"] as const)[i % 3];
    store.putRun({
      id: `fixture-run-${String(i + 1).padStart(3, "0")}`,
      projectName: names[index],
      projectPath: p?.path || join(dir, "workspace", names[index]),
      request: {
        projectId: p?.id || "archived",
        workflowPath:
          i % 3 === 0
            ? ".github/workflows/release.yml"
            : ".github/workflows/ci.yml",
        event: i % 3 === 0 ? "workflow_dispatch" : "push",
        inputs: {},
        architecture: "auto",
      },
      source,
      state,
      createdAt,
      startedAt: createdAt,
      finishedAt: new Date(
        Date.parse(createdAt) + 42000 + i * 1000,
      ).toISOString(),
      exitCode: state === "succeeded" ? 0 : 1,
      command: ["act", "push"],
    });
  }
}
console.log("FIXTURE_DATA_DIR=" + dir);
