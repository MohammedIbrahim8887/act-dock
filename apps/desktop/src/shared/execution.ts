import { z } from "zod";

export const architectureSchema = z.enum([
  "auto",
  "linux/amd64",
  "linux/arm64",
]);
export const imageReferenceSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/,
    "Use a Docker image reference, without credentials or shell options.",
  );
export const secretNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .max(100)
  .transform((s) => s.toUpperCase());
export const executionOptionsSchema = z.object({
  runnerMappings: z
    .record(
      z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
        .transform((label) => label.toLowerCase()),
      imageReferenceSchema,
    )
    .optional(),
  imagePullPolicy: z.enum(["if-missing", "always", "never"]).optional(),
  actionCachePolicy: z
    .enum(["cache-first", "refresh", "cached-only"])
    .optional(),
  packageCaches: z
    .array(z.enum(["npm", "pnpm", "bun"]))
    .max(3)
    .optional(),
  workspaceMode: z.enum(["copy", "bind"]).optional(),
  concurrentJobs: z.number().int().min(1).max(64).optional(),
  secretNames: z.array(secretNameSchema).max(100).optional(),
  reservation: z
    .object({
      cpus: z.number().positive().max(128),
      memoryGiB: z.number().positive().max(1024),
    })
    .optional(),
});
export type ExecutionOptions = z.infer<typeof executionOptionsSchema>;
export type ResolvedExecution = Required<
  Omit<ExecutionOptions, "concurrentJobs">
> &
  Pick<ExecutionOptions, "concurrentJobs">;
export const defaultMappings = {
  "ubuntu-latest": "catthehacker/ubuntu:act-24.04",
  "ubuntu-20.04": "catthehacker/ubuntu:act-20.04",
  "ubuntu-22.04": "catthehacker/ubuntu:act-22.04",
  "ubuntu-24.04": "catthehacker/ubuntu:act-24.04",
};
export const defaultExecution: ResolvedExecution = {
  runnerMappings: defaultMappings,
  imagePullPolicy: "if-missing",
  actionCachePolicy: "cache-first",
  packageCaches: [],
  workspaceMode: "copy",
  secretNames: [],
  reservation: { cpus: 2, memoryGiB: 2 },
};
export const resolvedExecutionSchema = executionOptionsSchema
  .required()
  .extend({ concurrentJobs: executionOptionsSchema.shape.concurrentJobs });
export const imageResolutionSchema = z.object({
  reference: imageReferenceSchema,
  platform: z.string(),
  resolved: z.string(),
  available: z.boolean(),
  source: z.enum(["local", "registry"]),
  bytes: z.number().optional(),
  downloadBytes: z.number().optional(),
  checkedAt: z.string(),
});
export type ImageResolution = z.infer<typeof imageResolutionSchema>;
export const executionSnapshotSchema = z.object({
  options: resolvedExecutionSchema,
  provenance: z.record(z.string(), z.string()),
  engine: z.object({ path: z.string(), version: z.string() }).optional(),
  images: z.array(imageResolutionSchema).default([]),
  docker: z
    .object({
      host: z.string(),
      executable: z.string().optional(),
      certPath: z.string().optional(),
      tlsVerify: z.string().optional(),
    })
    .optional(),
  resourceExpectations: z
    .object({
      privateNames: z.boolean().optional(),
      networks: z.array(z.string()).optional(),
      services: z.array(
        z.object({ id: z.string(), image: imageReferenceSchema }),
      ),
    })
    .optional(),
  queuedWorkflowHashes: z.record(z.string(), z.string()).optional(),
  configurationHashes: z.record(z.string(), z.string()).optional(),
  workflowHashes: z.record(z.string(), z.string()).default({}),
  secretNames: z.array(z.string()).default([]),
});
export type ExecutionSnapshot = z.infer<typeof executionSnapshotSchema>;
export const runPhases = [
  "preflight",
  "preparing",
  "executing",
  "cleanup",
] as const;
export const eventKinds = [
  "run",
  "queue",
  "job",
  "step",
  "logs",
  "image",
  "cache",
  "cleanup",
  "metrics",
  "settings",
  "projects",
] as const;
export const runEventSchema = z.object({
  seq: z.number(),
  runId: z.string().nullable(),
  kind: z.enum(eventKinds),
  time: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export type RunEvent = z.infer<typeof runEventSchema>;
export const preflightIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(["error", "warning", "unknown"]),
  message: z.string(),
  recoverable: z.boolean().default(false),
});
export const preflightReportSchema = z.object({
  checkedAt: z.string(),
  ready: z.boolean(),
  snapshot: executionSnapshotSchema,
  issues: z.array(preflightIssueSchema),
});
export type PreflightReport = z.infer<typeof preflightReportSchema>;
export const cacheEntrySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: z.enum(["action", "npm", "pnpm", "bun"]),
  path: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  bytes: z.number().nullable(),
  leases: z.number(),
  generation: z.number(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type CacheEntry = z.infer<typeof cacheEntrySchema>;
export const secretMetadataSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: secretNameSchema,
  revision: z.string(),
  updatedAt: z.string(),
  granted: z.boolean(),
});
export type SecretMetadata = z.infer<typeof secretMetadataSchema>;
export const metricSchema = z.object({
  cursor: z.number(),
  runId: z.string(),
  containerId: z.string(),
  time: z.string(),
  memoryBytes: z.number().nullable(),
  cpuPercent: z.number().nullable(),
});
export type RunMetric = z.infer<typeof metricSchema>;
export const executionResponses = {
  get_capabilities: z.object({
    apiVersion: z.literal(2),
    engineVersion: z.string(),
    features: z.array(z.string()),
  }),
  patch_settings: z.unknown(), // Replaced with settingsSchema in contracts.ts.
  preflight_run: preflightReportSchema,
  list_runner_images: z.array(
    z.object({
      label: z.string(),
      reference: z.string(),
      tier: z.enum(["medium", "full", "custom"]),
      legacy: z.boolean(),
      available: z.boolean().optional(),
    }),
  ),
  inspect_image: imageResolutionSchema,
  pull_image: z.object({ operationId: z.string() }),
  cancel_image_pull: z.null(),
  list_image_operations: z.array(
    z.object({
      id: z.string(),
      reference: z.string(),
      platform: z.string(),
      state: z.enum(["pulling", "complete", "failed", "cancelled"]),
      detail: z.string(),
      fraction: z.number().optional(),
    }),
  ),
  list_caches: z.array(cacheEntrySchema),
  clear_cache: z.null(),
  refresh_project_cache: z.object({ cleared: z.number() }),
  list_project_secrets: z.array(secretMetadataSchema),
  put_project_secret: secretMetadataSchema,
  delete_project_secret: z.null(),
  preview_import: z.object({
    names: z.array(z.string()),
    duplicates: z.array(z.string()),
  }),
  import_project_configuration: z.object({ imported: z.array(z.string()) }),
  supply_run_secrets: z.null(),
  read_events: z.object({
    events: z.array(runEventSchema),
    nextCursor: z.number(),
    hasMore: z.boolean(),
  }),
  get_run_metrics: z.object({
    entries: z.array(metricSchema),
    nextCursor: z.number(),
  }),
};
export type ExecutionResults = {
  [K in keyof typeof executionResponses]: z.infer<
    (typeof executionResponses)[K]
  >;
};

export type RunnerImage = ExecutionResults["list_runner_images"][number];
export const queueReasonSchema = z.string().min(1).max(128);
export type QueueReason = z.infer<typeof queueReasonSchema>;
