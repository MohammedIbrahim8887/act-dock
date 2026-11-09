import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDocument } from "yaml";
import {
  actEventFor,
  materializeGitLabWorkflow,
  parseGitLabPipeline,
} from "../src/runner/gitlab";
import { analyzeWorkflow } from "../src/runner/workflow-analysis";
import { commandArgs, discover, validateRun } from "../src/runner/workflows";
import { runRequestSchema, type Project } from "../src/shared/contracts";

let dir: string;
let project: Project;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ad-gitlab-"));
  project = { id: "p1", path: dir, name: "demo" } as unknown as Project;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const pipeline = (yaml: string) => writeFile(join(dir, ".gitlab-ci.yml"), yaml);
const request = (event = "push", jobId?: string) =>
  runRequestSchema.parse({
    projectId: project.id,
    workflowPath: ".gitlab-ci.yml",
    event,
    jobId,
  });

describe("GitLab CI conversion", () => {
  test("generated workflow is valid YAML with the expected jobs", async () => {
    await pipeline(`stages: [build, test]
build:
  stage: build
  script:
    - echo "build"
    - python3 -c "print(1)"
test:
  stage: test
  script: echo test
  after_script:
    - echo done
`);
    const out = materializeGitLabWorkflow(dir, ".gitlab-ci.yml");
    const doc = parseDocument(await Bun.file(out).text(), { uniqueKeys: true });
    expect(doc.errors).toEqual([]);
    const data = doc.toJS() as {
      jobs: Record<string, { needs?: string[]; steps: { run: string; if?: string }[] }>;
    };
    expect(Object.keys(data.jobs)).toEqual(["build", "test"]);
    expect(data.jobs.build.steps[0].run).toContain('python3 -c "print(1)"');
    expect(data.jobs.test.needs).toEqual(["build"]);
    expect(data.jobs.test.steps.at(-1)?.if).toBe("always()");
  });

  test("jobs in a later stage depend on earlier stages without explicit needs", async () => {
    await pipeline(`stages: [build, deploy]
build:
  stage: build
  script: make
deploy:
  stage: deploy
  script: make deploy
`);
    const w = (await discover(project)).find((x) => x.path === ".gitlab-ci.yml")!;
    expect(w.diagnostic).toBeUndefined();
    expect(w.jobs.find((j) => j.id === "build")!.needs).toEqual([]);
    expect(w.jobs.find((j) => j.id === "deploy")!.needs).toEqual(["build"]);
  });

  test("explicit needs replace stage ordering", () => {
    const p = parseGitLabPipeline(`stages: [build, test, deploy]
build:
  script: make
lint:
  stage: test
  script: lint
ship:
  stage: deploy
  needs: []
  script: ship
`);
    expect(p.jobs.find((j) => j.id === "ship")!.needs).toEqual([]);
  });

  test("inherited scripts come from the template, never a placeholder", () => {
    const p = parseGitLabPipeline(`.base:
  script: echo from template
  variables:
    A: "1"
job:
  extends: .base
  variables:
    B: 2
`);
    const job = p.jobs.find((j) => j.id === "job")!;
    expect(job.script).toEqual(["echo from template"]);
    expect(job.env).toEqual({ A: "1", B: "2" });
  });

  test("a job without any script is rejected instead of passing", () => {
    expect(() => parseGitLabPipeline("job:\n  stage: test\n")).toThrow(
      "has no script",
    );
  });

  test("a script line that YAML reads as a mapping is rejected, not run as text", () => {
    // Unquoted `: ` makes this a mapping, which must not become "[object Object]".
    expect(() =>
      parseGitLabPipeline('job:\n  script:\n    - echo "tests: $NODE_ENV"\n'),
    ).toThrow("must be a string or a list of strings");
  });

  test("unresolved extends and include are reported as diagnostics", async () => {
    await pipeline("job:\n  extends: .missing\n  script: echo hi\n");
    const [w] = (await discover(project)).filter((x) => x.path === ".gitlab-ci.yml");
    expect(w.diagnostic).toContain(".missing");

    expect(() =>
      parseGitLabPipeline("include: other.yml\njob:\n  script: echo hi\n"),
    ).toThrow("include is not supported");
  });

  test("needs that point at unknown jobs are rejected", () => {
    expect(() =>
      parseGitLabPipeline("job:\n  needs: [ghost]\n  script: echo hi\n"),
    ).toThrow("not a job in this pipeline");
  });

  test("events are offered and run as the Act events they map to", async () => {
    await pipeline("job:\n  script: echo hi\n");
    const [w] = (await discover(project)).filter((x) => x.path === ".gitlab-ci.yml");
    expect(w.events).toEqual(["push", "merge_request", "manual"]);
    expect(actEventFor("merge_request")).toBe("pull_request");
    expect(actEventFor("manual")).toBe("workflow_dispatch");
    const args = commandArgs(project, request("merge_request"), "run-1");
    expect(args[0]).toBe("pull_request");
    const generated = await Bun.file(args[2]).text();
    expect(parseDocument(generated).toJS().on).toMatchObject({
      push: {},
      pull_request: {},
      workflow_dispatch: {},
    });
  });

  test("validation and analysis use the converted jobs, including single-job runs", async () => {
    await pipeline(`stages: [build, deploy]
build:
  stage: build
  script: make
deploy:
  stage: deploy
  script: make deploy
`);
    const selected = await validateRun(project, request("push", "deploy"));
    expect(selected.jobs.map((j) => j.id)).toEqual(["build", "deploy"]);
    const analysis = await analyzeWorkflow(project, request("push", "deploy"));
    expect(analysis).toBeDefined();
  });
});

describe("GitLab execution settings", () => {
  test.each([
    "when: manual", "when: never", "when: on_failure",
    "rules: [{when: never}]", "only: [main]", "except: [branches]",
  ])("rejects unsupported job conditions: %s", (condition) => {
    expect(() => parseGitLabPipeline(`job:\n  script: echo deploy\n  ${condition}\n`)).toThrow("not supported");
  });

  test("inherited and pipeline conditions are rejected during discovery", async () => {
    await pipeline(".base:\n  when: manual\njob:\n  extends: .base\n  script: echo deploy\n");
    expect((await discover(project))[0].diagnostic).toContain("when=manual");
    expect(() => parseGitLabPipeline("workflow:\n  rules: [{when: never}]\njob:\n  script: echo deploy\n")).toThrow("workflow.rules");
  });

  test("preserves default and overridden images through materialization and analysis", async () => {
    await pipeline("default:\n  image: node:20\nnode:\n  script: node --version\npython:\n  image: {name: 'python:3.12'}\n  script: python --version\n");
    const data = parseDocument(await Bun.file(materializeGitLabWorkflow(dir, ".gitlab-ci.yml")).text()).toJS();
    expect(data.jobs.node.container.image).toBe("node:20");
    expect(data.jobs.python.container.image).toBe("python:3.12");
    expect(data.jobs.node.steps[0].shell).toBe("sh");
    const analysis = await analyzeWorkflow(project, request());
    expect(JSON.stringify(analysis)).toContain("python:3.12");
    expect(JSON.stringify(analysis)).toContain("node:20");
  });

  test.each(["{name: 'alpine:3', entrypoint: ['']}", "'$IMAGE'", "{}"])("rejects unsupported image configuration: %s", (image) => {
    expect(() => parseGitLabPipeline(`job:\n  image: ${image}\n  script: echo hi\n`)).toThrow("image");
  });

  test("cleanup always runs without overriding the main script outcome", async () => {
    await pipeline("job:\n  script: exit 0\n  after_script: exit 1\n");
    const data = parseDocument(await Bun.file(materializeGitLabWorkflow(dir, ".gitlab-ci.yml")).text()).toJS();
    expect(data.jobs.job.steps[0]["continue-on-error"]).toBeUndefined();
    expect(data.jobs.job.steps[1]).toMatchObject({ if: "always()", "continue-on-error": true, run: "exit 1" });
  });
});
