import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  symlink,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/runner/store";
import { browseFolders } from "../src/runner/folders";
import {
  historyQuerySchema,
  methods,
  runRequestSchema,
  type Run,
} from "../src/shared/contracts";
let directory: string, store: Store;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ad-history-"));
  await mkdir(join(directory, "logs"));
  store = new Store(directory);
  store.putProject({
    id: "current",
    name: "Current project",
    path: directory,
    defaults: {},
  });
});
afterEach(async () => {
  store.close();
  await rm(directory, { recursive: true, force: true });
});
function save(id: string, values: Partial<Run> = {}) {
  const run: Run = {
    id,
    projectName: "Current project",
    projectPath: directory,
    request: runRequestSchema.parse({
      projectId: "current",
      workflowPath: ".github/workflows/ci.yml",
      event: "push",
    }),
    source: "desktop",
    state: "succeeded",
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    command: [],
    ...values,
  };
  return store.putRun(run);
}
test("history pages are counted and sliced server-side with deterministic ordering", () => {
  for (let i = 0; i < 47; i++) save("run-" + i);
  const first = store.history(
    historyQuerySchema.parse({ page: 1, pageSize: 10 }),
  );
  const second = store.history(
    historyQuerySchema.parse({ page: 2, pageSize: 10 }),
  );
  expect(first.total).toBe(47);
  expect(first.totalPages).toBe(5);
  expect(first.runs).toHaveLength(10);
  expect(second.runs).toHaveLength(10);
  expect(new Set([...first.runs, ...second.runs].map((r) => r.id)).size).toBe(
    20,
  );
  const final = store.history(
    historyQuerySchema.parse({ page: 999, pageSize: 10 }),
  );
  expect(final.page).toBe(5);
  expect(final.runs).toHaveLength(7);
});
test("combined project, status, source, query and date filters precede pagination", () => {
  save("match", { state: "failed", source: "mcp" });
  save("other-status");
  save("other-source", { state: "failed", source: "cli" });
  save("old", {
    state: "failed",
    source: "mcp",
    createdAt: "2020-01-01T00:00:00.000Z",
  });
  save("other-project", {
    state: "failed",
    source: "mcp",
    request: runRequestSchema.parse({
      projectId: "removed",
      workflowPath: ".github/workflows/ci.yml",
      event: "push",
    }),
    projectName: "Removed project",
  });
  const filtered = store.history(
    historyQuerySchema.parse({
      projectId: "current",
      state: "failed",
      source: "mcp",
      query: "CI.YML",
      since: new Date(Date.now() - 86400000).toISOString(),
      pageSize: 1,
    }),
  );
  expect(filtered.total).toBe(1);
  expect(filtered.unfilteredTotal).toBe(5);
  expect(filtered.runs.map((r) => r.id)).toEqual(["match"]);
  expect(filtered.projects.find((p) => p.id === "removed")).toEqual({
    id: "removed",
    name: "Removed project",
    available: false,
  });
});
test("history search is literal, parameterized, and includes IDs, job names and retained project names", () => {
  save("special-id", {
    request: runRequestSchema.parse({
      projectId: "current",
      workflowPath: ".github/workflows/coverage_100%.yml",
      jobId: "unit-tests",
      event: "push",
    }),
  });
  save("ordinary");
  for (const query of ["100%", "special-id", "unit-tests"])
    expect(
      store.history(historyQuerySchema.parse({ query })).runs.map((r) => r.id),
    ).toEqual(["special-id"]);
  expect(
    store.history(historyQuerySchema.parse({ query: "' OR 1=1 --" })).total,
  ).toBe(0);
  expect(
    store.history(historyQuerySchema.parse({ query: "Current project" })).total,
  ).toBe(2);
});
test("empty results and shrinking filtered pages return a usable clamped page", () => {
  expect(store.history(historyQuerySchema.parse({ page: 90 }))).toMatchObject({
    runs: [],
    total: 0,
    page: 1,
    totalPages: 1,
  });
  for (let i = 0; i < 11; i++) save("fail-" + i, { state: "failed" });
  expect(
    store.history(
      historyQuerySchema.parse({ state: "failed", page: 2, pageSize: 10 }),
    ).page,
  ).toBe(2);
  store.putRun({ ...store.run("fail-0"), state: "succeeded" });
  const page = store.history(
    historyQuerySchema.parse({ state: "failed", page: 2, pageSize: 10 }),
  );
  expect(page.page).toBe(1);
  expect(page.total).toBe(10);
});
test("legacy run listing stays an array and accepts the same optional filters", () => {
  save("desktop");
  save("agent", { source: "mcp" });
  const query = methods.list_runs.parse({ source: "mcp", limit: 1 });
  const runs = store.listRuns(query, query.cursor, query.limit);
  expect(Array.isArray(runs)).toBe(true);
  expect(runs.map((r) => r.id)).toEqual(["agent"]);
  expect(() => historyQuerySchema.parse({ page: 0 })).toThrow();
  expect(() => historyQuerySchema.parse({ pageSize: 101 })).toThrow();
  expect(() => historyQuerySchema.parse({ state: "invalid" })).toThrow();
});
test("folder browsing shows directories, follows folder links, and detects workflows without adding a project", async () => {
  await mkdir(join(directory, "alpha"));
  await mkdir(join(directory, "beta"));
  await mkdir(join(directory, ".hidden"));
  await mkdir(join(directory, ".github/workflows"), { recursive: true });
  await writeFile(join(directory, "file.txt"), "file");
  await symlink(join(directory, "alpha"), join(directory, "shortcut"));
  await symlink(join(directory, "file.txt"), join(directory, "file-link"));
  await symlink(join(directory, "missing"), join(directory, "broken"));
  const listing = await browseFolders({ path: directory });
  expect(listing.path).toBe(await realpath(directory));
  expect(listing.hasWorkflows).toBe(true);
  expect(listing.folders.map((f) => f.name)).toEqual([
    "alpha",
    "beta",
    "logs",
    "shortcut",
  ]);
  expect(store.projects()).toHaveLength(1);
  const hidden = await browseFolders({ path: directory, showHidden: true });
  expect(hidden.folders.some((f) => f.name === ".github")).toBe(true);
  expect(hidden.folders.some((f) => f.name === ".hidden")).toBe(true);
  const linked = await browseFolders({ path: join(directory, "shortcut") });
  expect(linked.path).toBe(await realpath(join(directory, "alpha")));
  expect(linked.parentPath).toBe(await realpath(directory));
  await expect(browseFolders({ path: "relative/path" })).rejects.toThrow(
    "absolute",
  );
  await expect(
    browseFolders({ path: join(directory, "missing") }),
  ).rejects.toThrow();
});
