import { z } from "zod";
import {
  queueReasonSchema,
  architectureSchema,
  executionOptionsSchema,
  executionSnapshotSchema,
  runPhases,
  imageReferenceSchema,
  secretNameSchema,
  executionResponses,
  type ExecutionSnapshot,
  type ExecutionResults,
} from "./execution";
export * from "./execution";
const secretOverridesSchema = z
  .record(
    secretNameSchema,
    z
      .string()
      .refine(
        (v) => new TextEncoder().encode(v).length <= 49152,
        "Secrets must be at most 48 KiB.",
      ),
  )
  .refine(
    (v) => new TextEncoder().encode(JSON.stringify(v)).length <= 524288,
    "Overrides must be at most 512 KiB.",
  );
export const runRequestSchema = z.object({
  projectId: z.string().min(1),
  workflowPath: z.string().min(1),
  jobId: z.string().optional(),
  event: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  inputs: z.record(z.string(), z.string()).default({}),
  eventFile: z.string().optional(),
  envFile: z.string().optional(),
  varFile: z.string().optional(),
  secretFile: z.string().optional(),
  architecture: architectureSchema.default("auto"),
  execution: executionOptionsSchema.optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});
export type RunRequest = z.infer<typeof runRequestSchema>;
export const settingsSchema = z.object({
  theme: z.enum(["system", "light", "dark"]).default("system"),
  startAtLogin: z.boolean().default(false),
  actPath: z.string().default(""),
  dockerPath: z.string().default(""),
  cacheBudgets: z
    .object({
      projectGiB: z.number().positive().max(1024),
      totalGiB: z.number().positive().max(4096),
    })
    .optional(),
  executionDefaults: executionOptionsSchema.optional(),
  concurrency: z
    .object({
      enabled: z.boolean(),
      maxWorkflows: z.number().int().min(1).max(8),
    })
    .optional(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const runStates = [
  "queued",
  "running",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
] as const;
export type RunState = (typeof runStates)[number];
export const activeStates: RunState[] = ["queued", "running", "cancelling"];
export type Project = {
  id: string;
  path: string;
  name: string;
  defaults: Partial<RunRequest>;
};
export type WorkflowInput = {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: string;
  options: string[];
};
export type Job = {
  id: string;
  name: string;
  needs: string[];
  runners: string[];
  uses?: string;
  container?: boolean;
};
export type Workflow = {
  projectId: string;
  path: string;
  name: string;
  events: string[];
  jobs: Job[];
  inputs: WorkflowInput[];
  diagnostic?: string;
};
export type Run = {
  id: string;
  projectName: string;
  projectPath: string;
  request: RunRequest;
  source: "desktop" | "cli" | "mcp";
  state: RunState;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  diagnostic?: string;
  command: string[];
  phase?: (typeof runPhases)[number];
  queueReason?: string;
  snapshot?: ExecutionSnapshot;
  overrideFingerprint?: string;
  ephemeralSecretNames?: string[];
  needsSecretInput?: boolean;
};
export type LogEntry = {
  cursor: number;
  time: string;
  stream: string;
  message: string;
  job?: string;
  level?: string;
  jobKey?: string;
  stepId?: string[];
  stage?: string;
  stepResult?: string;
  rawOutput?: boolean;
};
export type LogPage = { entries: LogEntry[]; nextCursor: number; end: boolean };
export type Health = {
  act: { path?: string; ok: boolean; message: string };
  docker: { path?: string; ok: boolean; message: string };
  version: string;
  executable: string;
};
export const runFiltersSchema = z.object({
  projectId: z.string().optional(),
  state: z.enum(runStates).optional(),
  source: z.enum(["desktop", "cli", "mcp"]).optional(),
  query: z.string().trim().max(200).optional(),
  since: z.string().datetime().optional(),
});
export type RunFilters = z.infer<typeof runFiltersSchema>;
export const historyQuerySchema = runFiltersSchema.extend({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type HistoryPage = z.infer<typeof historyPageSchema>;
export const folderListingSchema = z.object({
  path: z.string(),
  parentPath: z.string().nullable(),
  folders: z.array(z.object({ name: z.string(), path: z.string() })),
  shortcuts: z.array(z.object({ name: z.string(), path: z.string() })),
  hasWorkflows: z.boolean(),
});
export type FolderListing = z.infer<typeof folderListingSchema>;
export const checkStatuses = [
  "ok",
  "warning",
  "error",
  "pending",
  "info",
  "skipped",
] as const;
export const healthActions = [
  "start_docker",
  "pull_image",
  "cleanup_resources",
] as const;
export const healthCheckSchema = z.object({
  id: z.string(),
  group: z.enum(["required", "recommended", "environment"]),
  title: z.string(),
  status: z.enum(checkStatuses),
  summary: z.string(),
  detail: z.string().optional(),
  facts: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        mono: z.boolean().optional(),
      }),
    )
    .default([]),
  /** A fix the runner can perform, a place in the app, or documentation. */
  action: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("runner"),
        id: z.enum(healthActions),
        label: z.string(),
      }),
      z.object({
        kind: z.literal("view"),
        target: z.enum(["settings", "agents"]),
        label: z.string(),
      }),
      z.object({
        kind: z.literal("link"),
        url: z.string().url(),
        label: z.string(),
      }),
    ])
    .optional(),
  command: z.string().optional(),
  progress: z
    .object({
      label: z.string(),
      fraction: z.number().min(0).max(1).optional(),
    })
    .optional(),
});
export type HealthCheck = z.infer<typeof healthCheckSchema>;
export type HealthCheckInput = z.input<typeof healthCheckSchema>;
export type CheckStatus = HealthCheck["status"];
export type HealthAction = (typeof healthActions)[number];
export const healthReportSchema = z.object({
  checkedAt: z.string(),
  /** blocked: pipelines can't run; attention: they can, with caveats; ready: everything passed. */
  overall: z.enum(["ready", "attention", "blocked"]),
  checks: z.array(healthCheckSchema),
});
export type HealthReport = z.infer<typeof healthReportSchema>;
const id = z.object({ runId: z.string().min(1) });
export const methods = {
  list_projects: z.object({}),
  browse_folders: z.object({
    path: z.string().optional(),
    showHidden: z.boolean().default(false),
  }),
  get_run_history: historyQuerySchema,
  add_project: z.object({ path: z.string().min(1) }),
  remove_project: z.object({ projectId: z.string() }),
  save_defaults: z.object({
    projectId: z.string(),
    defaults: runRequestSchema
      .extend({
        inputs: runRequestSchema.shape.inputs.removeDefault().optional(),
        architecture: runRequestSchema.shape.architecture
          .removeDefault()
          .optional(),
      })
      .partial(),
  }),
  list_workflows: z.object({ projectId: z.string() }),
  run_pipeline: runRequestSchema.extend({
    secretOverrides: secretOverridesSchema.optional(),
  }),
  get_capabilities: z.object({}),
  get_execution_config: z.object({ projectId: z.string() }),
  get_runner_snapshot: z.object({}),
  patch_settings: settingsSchema
    .extend({
      theme: settingsSchema.shape.theme.removeDefault().optional(),
      startAtLogin: settingsSchema.shape.startAtLogin
        .removeDefault()
        .optional(),
      actPath: settingsSchema.shape.actPath.removeDefault().optional(),
      dockerPath: settingsSchema.shape.dockerPath.removeDefault().optional(),
    })
    .partial(),
  preflight_run: z.object({ request: runRequestSchema }),
  list_runner_images: z.object({ projectId: z.string().optional() }),
  inspect_image: z.object({
    reference: imageReferenceSchema,
    architecture: architectureSchema.default("auto"),
  }),
  pull_image: z.object({
    reference: imageReferenceSchema,
    architecture: architectureSchema.default("auto"),
  }),
  cancel_image_pull: z.object({ operationId: z.string() }),
  list_image_operations: z.object({}),
  list_caches: z.object({ projectId: z.string().optional() }),
  clear_cache: z.object({ cacheId: z.string() }),
  refresh_project_cache: z.object({ projectId: z.string() }),
  list_project_secrets: z.object({ projectId: z.string() }),
  put_project_secret: z.object({
    projectId: z.string(),
    name: secretNameSchema,
    value: z
      .string()
      .refine((v) => new TextEncoder().encode(v).length <= 49152),
    granted: z.boolean().default(true),
  }),
  delete_project_secret: z.object({
    projectId: z.string(),
    name: secretNameSchema,
  }),
  preview_import: z.object({
    projectId: z.string(),
    path: z.string(),
    target: z.enum(["env", "vars", "secrets"]),
  }),
  import_project_configuration: z.object({
    projectId: z.string(),
    path: z.string(),
    target: z.enum(["env", "vars", "secrets"]),
    names: z
      .array(
        z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
          .max(100),
      )
      .max(1000),
    overwrite: z.boolean().default(false),
  }),
  supply_run_secrets: id.extend({ values: secretOverridesSchema }),
  read_events: z.object({
    cursor: z.number().int().min(0).default(0),
    runIds: z.array(z.string()).max(100).optional(),
    limit: z.number().int().min(1).max(2000).default(500),
    waitMs: z.number().int().min(0).max(10000).default(0),
  }),
  get_run_metrics: id.extend({
    cursor: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(1000).default(100),
  }),
  list_runs: runFiltersSchema.extend({
    cursor: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  get_run: id,
  get_run_logs: id.extend({
    cursor: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(2000).default(500),
  }),
  cancel_run: id,
  get_settings: z.object({}),
  update_settings: settingsSchema,
  health: z.object({}),
  check_health: z.object({}),
  fix_health: z.object({ action: z.enum(healthActions) }),
  stop: z.object({}),
} as const;
export type Method = keyof typeof methods;
export type Results = Omit<ExecutionResults, "patch_settings"> & {
  get_execution_config: {
    effective: ExecutionSnapshot;
    inherited: ExecutionSnapshot;
  };
  patch_settings: Settings;
  get_runner_snapshot: { runs: Run[]; cursor: number };
  list_projects: Project[];
  browse_folders: FolderListing;
  get_run_history: HistoryPage;
  add_project: Project;
  remove_project: null;
  save_defaults: Project;
  list_workflows: Workflow[];
  run_pipeline: Run;
  list_runs: Run[];
  get_run: Run;
  get_run_logs: LogPage;
  cancel_run: Run;
  get_settings: Settings;
  update_settings: Settings;
  health: Health;
  check_health: HealthReport;
  fix_health: { message: string };
  stop: null;
};
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export type ServiceReply =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string } };

// Validate service responses as well as requests at every process boundary.
const projectSchema = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string(),
  defaults: runRequestSchema.partial(),
});
const workflowSchema = z.object({
  projectId: z.string(),
  path: z.string(),
  name: z.string(),
  events: z.array(z.string()),
  jobs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      needs: z.array(z.string()),
      runners: z.array(z.string()),
      uses: z.string().optional(),
      container: z.boolean().optional(),
    }),
  ),
  inputs: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      description: z.string(),
      required: z.boolean(),
      default: z.string().optional(),
      options: z.array(z.string()),
    }),
  ),
  diagnostic: z.string().optional(),
});
const runSchema = z.object({
  id: z.string(),
  projectName: z.string(),
  projectPath: z.string(),
  request: runRequestSchema,
  source: z.enum(["desktop", "cli", "mcp"]),
  state: z.enum(runStates),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  exitCode: z.number().optional(),
  diagnostic: z.string().optional(),
  command: z.array(z.string()),
  phase: z.enum(runPhases).optional(),
  queueReason: queueReasonSchema.optional(),
  ephemeralSecretNames: z.array(z.string()).optional(),
  snapshot: executionSnapshotSchema.optional(),
});
export const historyPageSchema = z.object({
  runs: z.array(runSchema),
  total: z.number().int().nonnegative(),
  unfilteredTotal: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(1),
  projects: z.array(
    z.object({ id: z.string(), name: z.string(), available: z.boolean() }),
  ),
});
const logSchema = z.object({
  cursor: z.number(),
  time: z.string(),
  stream: z.string(),
  message: z.string(),
  job: z.string().optional(),
  level: z.string().optional(),
  jobKey: z.string().optional(),
  stepId: z.array(z.string()).optional(),
  stage: z.string().optional(),
  stepResult: z.string().optional(),
  rawOutput: z.boolean().optional(),
});
const dependencySchema = z.object({
  path: z.string().optional(),
  ok: z.boolean(),
  message: z.string(),
});
export const responses = {
  ...executionResponses,
  get_execution_config: z.object({
    effective: executionSnapshotSchema,
    inherited: executionSnapshotSchema,
  }),
  patch_settings: settingsSchema,
  get_runner_snapshot: z.object({
    runs: z.array(runSchema),
    cursor: z.number(),
  }),
  list_projects: z.array(projectSchema),
  browse_folders: folderListingSchema,
  get_run_history: historyPageSchema,
  add_project: projectSchema,
  remove_project: z.null(),
  save_defaults: projectSchema,
  list_workflows: z.array(workflowSchema),
  run_pipeline: runSchema,
  list_runs: z.array(runSchema),
  get_run: runSchema,
  cancel_run: runSchema,
  get_run_logs: z.object({
    entries: z.array(logSchema),
    nextCursor: z.number(),
    end: z.boolean(),
  }),
  get_settings: settingsSchema,
  update_settings: settingsSchema,
  health: z.object({
    act: dependencySchema,
    docker: dependencySchema,
    version: z.string(),
    executable: z.string(),
  }),
  check_health: healthReportSchema,
  fix_health: z.object({ message: z.string() }),
  stop: z.null(),
} satisfies { [M in Method]: z.ZodType<Results[M]> };
export const serviceReplySchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);
export function parseResponse<M extends Method>(
  method: M,
  data: unknown,
): Results[M] {
  return responses[method].parse(data) as Results[M];
}
