const labels: Record<string, string> = {
  "docker-endpoint-busy":
    "Finish active workflows before switching the runner’s Docker endpoint.",
  "unprovable-resource-namespace":
    "Dynamic or service resource names cannot be proven safe while existing Act resources remain. Inspect them in Docker before continuing.",
  "checking-resource-pressure":
    "Checking current Docker CPU and memory pressure.",
  "workflow-limit": "Waiting for an active workflow to finish.",
  "workspace-busy": "Another run is using this project’s workspace.",
  "container-namespace":
    "Another run uses the same Act container or resource names.",
  "shared-tool-cache":
    "Another run may be writing the shared action tool cache.",
  "resource-budget":
    "The requested CPU or memory reservation exceeds the available scheduling budget.",
  "live-resource-pressure":
    "Docker is busy. New work will start when CPU and memory pressure falls.",
  "cache-maintenance": "Project cache maintenance is in progress.",
  "pre-existing-container":
    "An existing Docker container has a name this workflow needs. Remove it manually or choose a different workflow name.",
  "pre-existing-volume":
    "An existing Docker workspace volume has a name this workflow needs. Check it before removing it manually.",
  "cleanup-required":
    "A previous run has unresolved resource cleanup. Inspect Docker resources before continuing.",
  "secret-input-required":
    "Re-enter the unsaved secrets lost when the runner restarted.",
  DOCKER_UNAVAILABLE: "Start Docker to continue.",
  ACT_UNAVAILABLE: "Repair the Act executable in Settings to continue.",
  VAULT_LOCKED: "Unlock your system vault to continue.",
  VAULT_UNAVAILABLE:
    "Your system vault is unavailable. Start its service or use a secrets file.",
  SECRET_NOT_FOUND:
    "A selected secret is missing. Replace it in project settings.",
  HELPER_UNAVAILABLE: "Reinstall Act Dock to restore its native helper.",
};
export function queueReasonText(reason: string) {
  return labels[reason] || reason.replaceAll("-", " ").replaceAll("_", " ");
}
