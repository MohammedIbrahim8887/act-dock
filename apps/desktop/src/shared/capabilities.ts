import { AppError, type Method } from "./contracts";
const features: Partial<Record<Method, string>> = {
  get_execution_config: "execution-config",
  patch_settings: "execution-config",
  preflight_run: "preflight",
  list_runner_images: "images",
  inspect_image: "images",
  pull_image: "images",
  cancel_image_pull: "images",
  list_image_operations: "images",
  list_caches: "caches",
  clear_cache: "caches",
  refresh_project_cache: "caches",
  list_project_secrets: "vault",
  put_project_secret: "vault",
  delete_project_secret: "vault",
  preview_import: "vault",
  import_project_configuration: "vault",
  supply_run_secrets: "vault",
  get_runner_snapshot: "events",
  read_events: "events",
  get_run_metrics: "metrics",
};
export function requiredFeature(method: Method, params: unknown) {
  if (
    method === "run_pipeline" &&
    params &&
    typeof params === "object" &&
    ((params as { execution?: unknown }).execution !== undefined ||
      (params as { secretOverrides?: unknown }).secretOverrides !== undefined ||
      (params as { architecture?: string }).architecture === "linux/arm64")
  )
    return "execution-config";
  return features[method];
}
export function requireFeature(
  feature: string,
  capabilities: { features: string[] },
) {
  if (!capabilities.features.includes(feature))
    throw new AppError(
      "RUNNER_UPGRADE_REQUIRED",
      `The running background service does not support ${feature}. Finish active work and reopen Act Dock to install the new runner.`,
    );
}
