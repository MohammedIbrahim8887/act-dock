import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AppError,
  defaultExecution,
  type PreflightReport,
  type RunRequest,
  type ExecutionSnapshot,
} from "../shared/contracts";
import { Store } from "./store";
import { Images } from "./images";
import { resolveExecution } from "./execution-config";
import {
  health,
  executionEnvironment,
  engineSupportsManagedExecution,
} from "./executor/act";
import { analyzeWorkflow } from "./workflow-analysis";
import { validateRun } from "./workflows";

export const compatibleAct = (version: string) => /\b0\.2\.89\b/.test(version);
export async function preflightRun(
  store: Store,
  images: Images,
  request: RunRequest,
  frozen?: ExecutionSnapshot,
): Promise<PreflightReport> {
  const project = store.project(request.projectId);
  const snapshot = frozen
    ? structuredClone(frozen)
    : resolveExecution(project, request, store.settings());
  const issues: PreflightReport["issues"] = [];
  const add = (
    code: string,
    severity: "error" | "warning" | "unknown",
    message: string,
    recoverable = false,
  ) => issues.push({ code, severity, message, recoverable });
  try {
    await validateRun(project, { ...request, execution: snapshot.options });
    const analysis = await analyzeWorkflow(project, {
      ...request,
      execution: snapshot.options,
    });
    snapshot.resourceExpectations = {
      services: analysis.services,
      privateNames: analysis.privateNames,
      networks: analysis.privateNames
        ? []
        : analysis.namespace
            .filter((name) => name.startsWith("network:"))
            .map((name) => name.slice(8)),
    };
    snapshot.workflowHashes[request.workflowPath] = analysis.hash;
    snapshot.configurationHashes = resolveExecution(
      project,
      request,
      store.settings(),
    ).configurationHashes;
    if (analysis.managedConflict && snapshot.options.packageCaches.length)
      add(
        "CONTAINER_OPTIONS_CONFLICT",
        "error",
        "This workflow defines container options. Disable managed package caches or add the cache volumes explicitly in the workflow.",
      );
    if (analysis.managedConflict)
      add(
        "CONTAINER_OWNERSHIP",
        "warning",
        "Workflow container options override Act's run labels. Cleanup uses verified resource IDs where available.",
      );
    const h = await health(store);
    snapshot.engine = { path: h.act.path || "", version: h.act.message };
    if (!h.act.ok) add("ACT_UNAVAILABLE", "error", h.act.message, true);
    if (!h.docker.ok)
      add("DOCKER_UNAVAILABLE", "error", h.docker.message, true);
    const adapterCompatible =
      h.act.ok &&
      compatibleAct(h.act.message) &&
      (await engineSupportsManagedExecution(h.act.path!));
    if (h.act.ok && !adapterCompatible) {
      add(
        "ENGINE_CAPABILITIES",
        "warning",
        "This Act version has not been verified with optimized execution. Basic runs remain available.",
      );
      if (
        (request.execution && Object.keys(request.execution).length) ||
        JSON.stringify(snapshot.options) !== JSON.stringify(defaultExecution)
      )
        add(
          "ENGINE_UNSUPPORTED",
          "error",
          "Use the bundled Act v0.2.89 for managed images, caches and execution options.",
        );
    }
    if (h.docker.ok && adapterCompatible) {
      const environment = await images.environment();
      if (environment.DOCKER_HOST)
        snapshot.docker = {
          host: environment.DOCKER_HOST,
          executable: images.docker(),
          certPath: environment.DOCKER_CERT_PATH,
          tlsVerify: environment.DOCKER_TLS_VERIFY,
        };
      const platform = await images.platform(request.architecture);
      for (const [label, container] of analysis.images) {
        const reference = container || snapshot.options.runnerMappings[label];
        if (!reference && label.includes("${{")) {
          add(
            "DYNAMIC_RUNNER_IMAGE",
            snapshot.options.imagePullPolicy === "never" ? "error" : "unknown",
            "Act evaluates this runner label at execution time. Managed image readiness cannot be fully verified; use literal mapped labels for local-only execution.",
          );
          continue;
        }
        if (!reference) {
          add(
            "UNMAPPED_RUNNER",
            "error",
            `Map the Linux runner label ${label} to an image.`,
          );
          continue;
        }
        if (reference.includes("${{")) {
          add(
            "DYNAMIC_IMAGE",
            "unknown",
            "Act will evaluate a dynamic job image at execution time.",
          );
          continue;
        }
        const result = await images.resolve(
          reference,
          platform,
          snapshot.options.imagePullPolicy,
          false,
        );
        snapshot.images = snapshot.images.filter(
          (i) => !(i.reference === reference && i.platform === platform),
        );
        snapshot.images.push(result);
        if (!result.available)
          add(
            "IMAGE_MISSING",
            snapshot.options.imagePullPolicy === "never" ? "error" : "warning",
            `Image ${reference} (${platform}) needs downloading.`,
          );
        if (container)
          add(
            "WORKFLOW_CONTAINER",
            "warning",
            "The workflow's container image takes precedence. Act owns its image pull behavior.",
          );
      }
      const docker = images.docker();
      try {
        const config = JSON.parse(
          await readFile(
            join(
              process.env.DOCKER_CONFIG ||
                join(process.env.HOME || "", ".docker"),
              "config.json",
            ),
            "utf8",
          ),
        );
        const helpers = new Set<string>(
          [
            config.credsStore,
            ...Object.values(config.credHelpers || {}),
          ].filter(Boolean) as string[],
        );
        for (const name of helpers)
          if (
            !Bun.which(`docker-credential-${name}`, {
              PATH: executionEnvironment(docker).PATH,
            })
          )
            add(
              "CREDENTIAL_HELPER_MISSING",
              "error",
              `Docker credential helper ${name} was not found. Repair Docker's installation or executable paths.`,
              true,
            );
      } catch {}
    }
    snapshot.secretNames = [...snapshot.options.secretNames];
    for (const name of analysis.secretNames)
      if (
        !snapshot.secretNames.includes(name) &&
        !request.secretFile &&
        name !== "GITHUB_TOKEN"
      )
        add(
          "SECRET_REFERENCE",
          "warning",
          `The workflow references secret ${name}. Select a saved secret or supply a secrets file.`,
        );
  } catch (e) {
    add(
      e instanceof AppError ? e.code : "PREFLIGHT_ERROR",
      "error",
      e instanceof AppError
        ? e.message
        : "Configuration could not be checked. Correct the workflow or dependency paths, then retry.",
      e instanceof AppError &&
        ["DOCKER_UNAVAILABLE", "IMAGE_PLATFORM_ADDRESS"].includes(e.code),
    );
  }
  return {
    checkedAt: new Date().toISOString(),
    ready: !issues.some((i) => i.severity === "error"),
    snapshot,
    issues,
  };
}
