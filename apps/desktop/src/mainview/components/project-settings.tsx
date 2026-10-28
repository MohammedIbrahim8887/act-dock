import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  FileText,
  HardDrive,
  KeyRound,
  LayoutList,
  Package,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { api, chooseFile } from "@/lib/api";
import { subscribeEvents } from "@/lib/events";
import { fail } from "./common";
import {
  CachePolicyPanel,
  OptionCards,
  RunBehaviorPanel,
  RunnerImagesPanel,
  SettingBlock,
  effectiveOf,
  formatBytes,
  imageTier,
  invalidMappings,
  projectRunnerUsage,
  relativeTime,
  sourceLabel,
  tierCopy,
  type Layers,
  type WorkflowImages,
} from "./execution-editor";
import type {
  CacheEntry,
  ExecutionOptions,
  ExecutionSnapshot,
  Project,
  SecretMetadata,
  Settings,
  Workflow,
} from "../../shared/contracts";

export type ProjectSettingsTab =
  | "overview"
  | "images"
  | "behavior"
  | "caches"
  | "secrets";
const tabFields: Record<ProjectSettingsTab, (keyof ExecutionOptions)[]> = {
  overview: [],
  images: ["runnerMappings", "imagePullPolicy"],
  behavior: ["workspaceMode", "concurrentJobs", "reservation"],
  caches: ["actionCachePolicy", "packageCaches"],
  secrets: [],
};
/** Secret grants are saved by the runner itself, so they never live in the draft. */
function editable(execution?: ExecutionOptions): ExecutionOptions {
  const { secretNames: _secretNames, ...rest } = execution || {};
  return rest;
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export function ProjectSettingsView({
  project,
  workflows,
  settings,
  tab,
  onTab,
  onSaved,
  onBack,
}: {
  project: Project;
  workflows: Workflow[];
  settings: Settings;
  tab: ProjectSettingsTab;
  onTab: (t: ProjectSettingsTab) => void;
  onSaved: (p: Project) => void;
  onBack: () => void;
}) {
  const saved = editable(project.defaults.execution);
  const savedWorkflows = project.defaults.workflowImages || {};
  const [inherited, setInherited] = useState<ExecutionSnapshot | null>(null),
    [draft, setDraft] = useState<ExecutionOptions>(saved),
    [workflowDraft, setWorkflowDraft] = useState<WorkflowImages>(
      savedWorkflows,
    ),
    [secrets, setSecrets] = useState<SecretMetadata[] | null>(null),
    [caches, setCaches] = useState<CacheEntry[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load() {
    const [s, c, config] = await Promise.all([
      api("list_project_secrets", { projectId: project.id }),
      api("list_caches", { projectId: project.id }),
      api("get_execution_config", { projectId: project.id }),
    ]);
    setSecrets(s);
    setCaches(c);
    setInherited(config.inherited);
    setError("");
  }
  useEffect(() => {
    void load().catch((e) => setError(fail(e)));
    return subscribeEvents((events) => {
      if (events.some((e) => e.kind === "settings" || e.kind === "cache"))
        void load().catch((e) => setError(fail(e)));
    });
  }, [project.id]);
  /** Pick up grant changes the runner made while saving or deleting secrets. */
  async function reloadProject() {
    const latest = (await api("list_projects")).find(
      (p) => p.id === project.id,
    );
    if (latest) onSaved(latest);
  }
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (e) {
      setError(fail(e));
    } finally {
      setBusy(false);
    }
  }
  const workflowsDirty = !same(workflowDraft, savedWorkflows);
  const dirty = !same(draft, saved) || workflowsDirty,
    invalid = [
      ...invalidMappings(draft),
      ...Object.entries(workflowDraft).flatMap(([path, runnerMappings]) =>
        invalidMappings({ runnerMappings }).map(
          (label) => `${label} in ${path.split("/").pop()}`,
        ),
      ),
    ];
  async function save() {
    await perform(async () => {
      const secretNames = project.defaults.execution?.secretNames;
      onSaved(
        await api("save_defaults", {
          projectId: project.id,
          defaults: {
            ...project.defaults,
            execution: { ...draft, ...(secretNames ? { secretNames } : {}) },
            workflowImages: workflowDraft,
          },
        }),
      );
      toast.success("Project settings saved");
    });
  }
  const layers: Layers | null = inherited && {
    base: inherited.options,
    overrides: draft,
    sourceOf: (key) => inherited.provenance[key] ?? "Built-in default",
    scope: "project",
    onChange: setDraft,
  };
  const changedTabs = (t: ProjectSettingsTab) =>
    tabFields[t].some((k) => !same(draft[k], saved[k])) ||
    (t === "images" && workflowsDirty);
  const tabs: [ProjectSettingsTab, string, typeof Boxes][] = [
    ["overview", "Overview", LayoutList],
    ["images", "Runner images", Boxes],
    ["behavior", "Run behavior", SlidersHorizontal],
    ["caches", "Caches", HardDrive],
    ["secrets", "Secrets & env", KeyRound],
  ];
  return (
    <div className="page-content settings-page">
      <header className="settings-heading">
        <Button variant="ghost" size="sm" className="back-link" onClick={onBack}>
          <ArrowLeft className="size-3.5" />
          Workflows
        </Button>
        <h1>Project settings</h1>
        <p>
          <strong>{project.name}</strong>
          <span className="mono" title={project.path}>
            {project.path}
          </span>
        </p>
      </header>
      <Tabs value={tab} onValueChange={(v) => onTab(v as ProjectSettingsTab)}>
        <TabsList variant="line" className="settings-tabs">
          {tabs.map(([value, label, Icon]) => (
            <TabsTrigger key={value} value={value}>
              <Icon className="size-3.5" />
              {label}
              {changedTabs(value) && (
                <span className="tab-dot" aria-label="Unsaved changes" />
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {error && (
          <p role="alert" className="form-error settings-error">
            {error}
          </p>
        )}
        {!layers ? (
          <div className="tab-stack" aria-busy="true">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : (
          <>
            <TabsContent value="overview">
              <Overview
                layers={layers}
                inherited={inherited!}
                workflows={workflows}
                workflowImages={workflowDraft}
                secrets={secrets}
                caches={caches}
                onTab={onTab}
              />
            </TabsContent>
            <TabsContent value="images">
              <RunnerImagesPanel
                layers={layers}
                workflows={workflows}
                workflowImages={workflowDraft}
                onWorkflowImages={setWorkflowDraft}
              />
            </TabsContent>
            <TabsContent value="behavior">
              <RunBehaviorPanel layers={layers} />
            </TabsContent>
            <TabsContent value="caches">
              <CachePolicyPanel layers={layers}>
                <CacheStorage
                  caches={caches}
                  budgetGiB={settings.cacheBudgets?.projectGiB ?? 5}
                  busy={busy}
                  onClear={(id) =>
                    void perform(() => api("clear_cache", { cacheId: id }))
                  }
                  onClearIdle={() =>
                    void perform(async () => {
                      const { cleared } = await api("refresh_project_cache", {
                        projectId: project.id,
                      });
                      toast.success(
                        cleared
                          ? `Cleared ${cleared} idle cache${cleared === 1 ? "" : "s"}`
                          : "No idle caches to clear",
                      );
                    })
                  }
                />
              </CachePolicyPanel>
            </TabsContent>
            <TabsContent value="secrets">
              <SecretsPanel
                project={project}
                secrets={secrets}
                busy={busy}
                perform={(action) =>
                  perform(async () => {
                    await action();
                    await reloadProject();
                  })
                }
              />
            </TabsContent>
          </>
        )}
      </Tabs>
      {dirty && (
        <div className="save-bar" role="region" aria-label="Unsaved changes">
          <span>
            {invalid.length
              ? `Fix the image for ${invalid.join(", ")} to save.`
              : "You have unsaved changes for this project."}
          </span>
          <Button variant="ghost" size="sm" onClick={() => {
              setDraft(saved);
              setWorkflowDraft(savedWorkflows);
            }}>
            Discard
          </Button>
          <Button
            size="sm"
            disabled={busy || invalid.length > 0}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
    </div>
  );
}

/* ── Overview ──────────────────────────────────────────────────── */

function Overview({
  layers,
  inherited,
  workflows,
  workflowImages,
  secrets,
  caches,
  onTab,
}: {
  layers: Layers;
  inherited: ExecutionSnapshot;
  workflows: Workflow[];
  workflowImages: WorkflowImages;
  secrets: SecretMetadata[] | null;
  caches: CacheEntry[] | null;
  onTab: (t: ProjectSettingsTab) => void;
}) {
  const effective = effectiveOf(layers);
  const usage = projectRunnerUsage(
    workflows,
    effective.runnerMappings,
    workflowImages,
  );
  const workflowRows = Object.entries(workflowImages).flatMap(([path, maps]) =>
    Object.entries(maps).map(([label, ref]) => ({
      path,
      label,
      ref,
      name: workflows.find((w) => w.path === path)?.name || path.split("/").pop(),
    })),
  );
  const used = [...usage.byLabel.keys()].sort();
  const skipped = [...usage.unmapped.values()].flat().length;
  const source = (key: string, overridden: boolean) =>
    overridden ? "This project" : sourceLabel(layers.sourceOf(key)).text;
  const cacheBytes = (caches || []).reduce((s, c) => s + (c.bytes || 0), 0);
  const rows: {
    label: string;
    value: ReactNode;
    from: string;
    tab: ProjectSettingsTab;
  }[] = [
    {
      label: "When to download images",
      value: {
        "if-missing": "Only when missing",
        always: "Before every run",
        never: "Never (offline)",
      }[effective.imagePullPolicy],
      from: source("imagePullPolicy", "imagePullPolicy" in layers.overrides),
      tab: "images",
    },
    {
      label: "Project files",
      value:
        effective.workspaceMode === "copy"
          ? "Copied into each run"
          : "Mounted directly (can be modified)",
      from: source("workspaceMode", "workspaceMode" in layers.overrides),
      tab: "behavior",
    },
    {
      label: "Parallel jobs",
      value: effective.concurrentJobs ?? "Automatic",
      from: source("concurrentJobs", "concurrentJobs" in layers.overrides),
      tab: "behavior",
    },
    {
      label: "Reservation",
      value: `${effective.reservation.cpus} CPUs · ${effective.reservation.memoryGiB} GiB`,
      from: source("reservation", "reservation" in layers.overrides),
      tab: "behavior",
    },
    {
      label: "Action sources",
      value: {
        "cache-first": "Cache first",
        refresh: "Refresh every run",
        "cached-only": "Cached only",
      }[effective.actionCachePolicy],
      from: source("actionCachePolicy", "actionCachePolicy" in layers.overrides),
      tab: "caches",
    },
    {
      label: "Package caches",
      value: effective.packageCaches.length
        ? effective.packageCaches.join(", ")
        : "Off",
      from: source("packageCaches", "packageCaches" in layers.overrides),
      tab: "caches",
    },
    {
      label: "Secrets",
      value:
        secrets === null
          ? "…"
          : `${secrets.length} saved in the system vault`,
      from: "This project",
      tab: "secrets",
    },
  ];
  const configFiles = [
    ...new Set(
      Object.values(inherited.provenance)
        .filter((s) => s.startsWith("Config: "))
        .map((s) => s.slice(8)),
    ),
  ];
  const count = (pred: (s: string) => boolean) =>
    Object.values(inherited.provenance).filter(pred).length;
  const overrides = Object.keys(layers.overrides).length
    - ("runnerMappings" in layers.overrides ? 1 : 0)
    + Object.keys(layers.overrides.runnerMappings || {}).length;
  const chain = [
    {
      name: "Built-in defaults",
      detail: "Act Dock’s starting point",
      count: count((s) => s === "Built-in default"),
    },
    {
      name: "Global settings",
      detail: "Settings page, shared by every project",
      count: count((s) => s === "Global settings"),
    },
    ...configFiles.map((path) => ({
      name: path.split(/[\\/]/).pop() || path,
      detail: path,
      count: count((s) => s === `Config: ${path}`),
    })),
    {
      name: "This project",
      detail: "Saved on this page",
      count: overrides,
    },
  ];
  return (
    <div className="tab-stack">
      <SettingBlock
        title="Runner images"
        description="What each job in this project runs on."
        aside={
          <Button size="sm" variant="ghost" onClick={() => onTab("images")}>
            Manage
            <ArrowRight className="size-3.5" />
          </Button>
        }
      >
        {used.length ? (
          <ul className="overview-images">
            {used.map((label) => {
              const ref = effective.runnerMappings[label],
                tier = imageTier(ref),
                jobs = usage.byLabel.get(label)!.length;
              return (
                <li key={label}>
                  <code className="overview-label">{label}</code>
                  <ArrowRight className="size-3.5" aria-label="uses" />
                  <code className="overview-ref" title={ref}>
                    {ref}
                  </code>
                  <span className="image-tier" data-tier={tier}>
                    {tierCopy[tier].title}
                  </span>
                  <span className="overview-jobs">
                    {jobs} job{jobs === 1 ? "" : "s"}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="quiet-empty">
            {workflows.length
              ? "No jobs in this project target a mapped runner label."
              : "No workflows found in this project yet."}
          </p>
        )}
        {workflowRows.length > 0 && (
          <ul className="overview-images">
            {workflowRows.map((row) => {
              const tier = imageTier(row.ref);
              return (
                <li key={`${row.path}:${row.label}`}>
                  <code className="overview-label">{row.label}</code>
                  <ArrowRight className="size-3.5" aria-label="uses" />
                  <code className="overview-ref" title={row.ref}>
                    {row.ref}
                  </code>
                  <span className="image-tier" data-tier={tier}>
                    {tierCopy[tier].title}
                  </span>
                  <span className="overview-jobs">{row.name} only</span>
                </li>
              );
            })}
          </ul>
        )}
        {usage.unmapped.size > 0 && (
          <p className="overview-warning">
            {skipped} job{skipped === 1 ? " targets a label" : "s target labels"}{" "}
            without an image and will be skipped.{" "}
            <button type="button" onClick={() => onTab("images")}>
              Map them
            </button>
          </p>
        )}
      </SettingBlock>
      <SettingBlock
        title="Effective configuration"
        description="What a run started from this project uses, and where each value comes from."
      >
        <dl className="config-table">
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
              <dd className="config-source" data-local={row.from === "This project" ? "" : undefined}>
                {row.from}
              </dd>
              <dd>
                <button
                  type="button"
                  className="config-edit"
                  onClick={() => onTab(row.tab)}
                  aria-label={`Change ${row.label}`}
                >
                  Change
                </button>
              </dd>
            </div>
          ))}
        </dl>
      </SettingBlock>
      <SettingBlock
        title="How settings combine"
        description="Each layer overrides the ones above it. Options chosen in the Run dialog apply last, to that run only."
      >
        <ol className="config-chain">
          {chain.map((layer, i) => (
            <li key={`${layer.name}-${i}`} data-local={i === chain.length - 1 ? "" : undefined}>
              <span className="chain-node" aria-hidden="true" />
              <div>
                <strong>{layer.name}</strong>
                <span className="mono" title={layer.detail}>
                  {layer.detail}
                </span>
              </div>
              <span className="chain-count">
                {layer.count
                  ? `${layer.count} value${layer.count === 1 ? "" : "s"}`
                  : "No values"}
              </span>
            </li>
          ))}
        </ol>
        <div className="overview-facts">
          {inherited.engine && (
            <span>
              Act <code>{inherited.engine.version}</code>
            </span>
          )}
          {inherited.docker && (
            <span>
              Docker <code title={inherited.docker.host}>{inherited.docker.host}</code>
            </span>
          )}
          {caches && (
            <span>
              Caches <code>{formatBytes(cacheBytes) || "0 B"}</code>
            </span>
          )}
        </div>
      </SettingBlock>
    </div>
  );
}

/* ── Caches ────────────────────────────────────────────────────── */

const cacheTitle = (c: CacheEntry) => {
  if (c.kind !== "action") return `${c.kind} downloads`;
  const url = String(c.metadata.url || c.path).replace(
    /^https?:\/\/(www\.)?github\.com\//,
    "",
  );
  const ref = c.metadata.ref ? `@${String(c.metadata.ref)}` : "";
  return `${url.replace(/\.git$/, "")}${ref}`;
};
function CacheStorage({
  caches,
  budgetGiB,
  busy,
  onClear,
  onClearIdle,
}: {
  caches: CacheEntry[] | null;
  budgetGiB: number;
  busy: boolean;
  onClear: (id: string) => void;
  onClearIdle: () => void;
}) {
  const total = (caches || []).reduce((s, c) => s + (c.bytes || 0), 0),
    budget = budgetGiB * 1024 ** 3,
    unknown = (caches || []).filter((c) => c.bytes === null).length,
    idle = (caches || []).filter((c) => !c.leases).length;
  const sorted = [...(caches || [])].sort(
    (a, b) => (b.bytes || 0) - (a.bytes || 0),
  );
  return (
    <SettingBlock
      title="Stored caches"
      description="Idle caches are removed oldest first when this project goes over its budget. Change budgets in Settings › Caches."
      aside={
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !idle}
          onClick={onClearIdle}
        >
          <Trash2 className="size-3.5" />
          Clear idle
        </Button>
      }
    >
      <div className="cache-meter">
        <div className="cache-meter-text">
          <strong>{formatBytes(total) || "0 B"}</strong>
          <span>of {budgetGiB} GiB budget</span>
          {unknown > 0 && (
            <span className="cache-unknown">
              · {unknown} not yet measured
            </span>
          )}
        </div>
        <div
          className="cache-meter-bar"
          role="meter"
          aria-label="Cache budget used"
          aria-valuemin={0}
          aria-valuemax={budget}
          aria-valuenow={total}
        >
          <span style={{ width: `${Math.min(100, (total / budget) * 100)}%` }} />
        </div>
      </div>
      {caches === null ? (
        <Skeleton className="h-24 w-full" />
      ) : caches.length ? (
        <ul className="cache-list">
          {sorted.map((c) => (
            <li key={c.id}>
              <span className="cache-icon" aria-hidden="true">
                {c.kind === "action" ? (
                  <Boxes className="size-4" />
                ) : (
                  <Package className="size-4" />
                )}
              </span>
              <div className="cache-text">
                <strong className={c.kind === "action" ? "mono" : undefined}>
                  {cacheTitle(c)}
                </strong>
                <span>
                  {c.kind === "action" ? "Action source" : "Package cache"} ·
                  used {relativeTime(c.lastUsedAt)}
                </span>
              </div>
              <span className="cache-size">
                {c.bytes === null ? "Unknown" : formatBytes(c.bytes)}
              </span>
              <span className="cache-state" data-active={c.leases ? "" : undefined}>
                {c.leases ? "In use" : "Idle"}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy || !!c.leases}
                aria-label={`Clear ${cacheTitle(c)}`}
                title={c.leases ? "In use by a run" : "Clear"}
                onClick={() => onClear(c.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="quiet-empty">
          Nothing cached yet. Caches fill as workflows run.
        </p>
      )}
    </SettingBlock>
  );
}

/* ── Secrets & environment ─────────────────────────────────────── */

function SecretsPanel({
  project,
  secrets,
  busy,
  perform,
}: {
  project: Project;
  secrets: SecretMetadata[] | null;
  busy: boolean;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [remove, setRemove] = useState<SecretMetadata | null>(null),
    [name, setName] = useState(""),
    [value, setValue] = useState(""),
    [path, setPath] = useState(""),
    [target, setTarget] = useState<"env" | "vars" | "secrets">("secrets"),
    [preview, setPreview] = useState<{
      names: string[];
      duplicates: string[];
    } | null>(null),
    [overwrite, setOverwrite] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const exists = useMemo(
    () => !!secrets?.some((s) => s.name === name),
    [secrets, name],
  );
  const nameValid = /^[A-Z_][A-Z0-9_]*$/.test(name);
  return (
    <div className="tab-stack">
      <SettingBlock
        title="Saved secrets"
        description="Values live in your system vault and can’t be read back here. Workflows in this project see them as secrets.NAME, from the desktop app, CLI and agents."
      >
        {secrets === null ? (
          <Skeleton className="h-16 w-full" />
        ) : secrets.length ? (
          <ul className="secret-list">
            {secrets.map((s) => (
              <li key={s.id}>
                <KeyRound className="size-3.5" aria-hidden="true" />
                <code>{s.name}</code>
                <span className="secret-mask" aria-hidden="true">
                  ••••••••
                </span>
                <span className="secret-meta">
                  {s.granted ? "Available to runs" : "Not granted"} · updated{" "}
                  {relativeTime(s.updatedAt)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setName(s.name);
                    setValue("");
                    nameInput.current?.focus();
                  }}
                >
                  Replace
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Delete ${s.name}`}
                  title="Delete"
                  onClick={() => setRemove(s)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="quiet-empty">
            No saved secrets. Secret files chosen in the Run dialog still work.
          </p>
        )}
      </SettingBlock>
      <SettingBlock
        title={exists ? `Replace ${name}` : "Add a secret"}
        description="Paste the value once. Multiline values are kept exactly."
      >
        <form
          className="secret-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!nameValid || !value) return;
            void perform(async () => {
              await api("put_project_secret", {
                projectId: project.id,
                name,
                value,
                granted: true,
              });
              toast.success(`${name} saved in the system vault`);
              setName("");
              setValue("");
            });
          }}
        >
          <div className="field">
            <Label htmlFor="secret-name">Name</Label>
            <Input
              id="secret-name"
              ref={nameInput}
              className="mono"
              autoComplete="off"
              spellCheck={false}
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase())}
              placeholder="DEPLOY_TOKEN"
              aria-invalid={(!!name && !nameValid) || undefined}
            />
            {name && !nameValid && (
              <p className="form-hint">
                Start with a letter or underscore. Use letters, numbers and
                underscores only.
              </p>
            )}
          </div>
          <div className="field">
            <Label htmlFor="secret-value">Value</Label>
            <Textarea
              id="secret-value"
              className="mono secret-value"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                exists
                  ? "Paste the new value. The current value is replaced."
                  : "Paste the value"
              }
            />
          </div>
          <div className="form-actions">
            {(name || value) && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setName("");
                  setValue("");
                }}
              >
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={busy || !nameValid || !value}>
              {exists ? "Replace secret" : "Save secret"}
            </Button>
          </div>
        </form>
      </SettingBlock>
      <SettingBlock
        title="Import from a .env file"
        description="Bring in many values at once. You’ll see the names before anything is written."
      >
        <div className="import-steps">
          <div className="import-step">
            <span className="step-number">1</span>
            <div className="field">
              <Label htmlFor="import-path">File</Label>
              <div className="file-field">
                <Input
                  id="import-path"
                  className="mono"
                  value={path}
                  placeholder="/path/to/.env"
                  onChange={(e) => {
                    setPath(e.target.value);
                    setPreview(null);
                  }}
                />
                <Button
                  variant="outline"
                  onClick={async () => {
                    const selected = await chooseFile();
                    if (selected) {
                      setPath(selected);
                      setPreview(null);
                    }
                  }}
                >
                  <FileText className="size-3.5" />
                  Choose…
                </Button>
              </div>
            </div>
          </div>
          <div className="import-step">
            <span className="step-number">2</span>
            <div className="field">
              <span className="field-label">Save values as</span>
              <OptionCards
                name="import-target"
                label="Save values as"
                value={target}
                onChange={(v) => {
                  setTarget(v);
                  setPreview(null);
                }}
                options={[
                  {
                    value: "secrets",
                    title: "Secrets",
                    description: "Stored in the system vault. Masked in logs.",
                  },
                  {
                    value: "env",
                    title: "Environment variables",
                    description: "Private file. Read as env.NAME.",
                  },
                  {
                    value: "vars",
                    title: "Workflow variables",
                    description: "Private file. Read as vars.NAME.",
                  },
                ]}
              />
            </div>
          </div>
          <div className="import-step">
            <span className="step-number">3</span>
            <div className="field">
              {!preview ? (
                <Button
                  variant="outline"
                  disabled={busy || !path}
                  onClick={() =>
                    void perform(async () =>
                      setPreview(
                        await api("preview_import", {
                          projectId: project.id,
                          path,
                          target,
                        }),
                      ),
                    )
                  }
                >
                  <Upload className="size-3.5" />
                  Preview names
                </Button>
              ) : (
                <>
                  <span className="field-label">
                    {preview.names.length} name
                    {preview.names.length === 1 ? "" : "s"} found
                  </span>
                  <ul className="name-chips">
                    {preview.names.map((n) => (
                      <li
                        key={n}
                        data-duplicate={
                          preview.duplicates.includes(n) ? "" : undefined
                        }
                      >
                        {n}
                        {preview.duplicates.includes(n) && <em>exists</em>}
                      </li>
                    ))}
                  </ul>
                  {preview.duplicates.length > 0 && (
                    <OptionCards
                      name="duplicate-policy"
                      label="Names that already exist"
                      value={String(overwrite) as "true" | "false"}
                      onChange={(v) => setOverwrite(v === "true")}
                      options={[
                        {
                          value: "false",
                          title: "Keep existing values",
                          description: `Skip ${preview.duplicates.length} name${preview.duplicates.length === 1 ? "" : "s"} already saved.`,
                        },
                        {
                          value: "true",
                          title: "Replace existing values",
                          description: "Overwrite them with the file’s values.",
                        },
                      ]}
                    />
                  )}
                  <div className="form-actions">
                    <Button variant="ghost" onClick={() => setPreview(null)}>
                      Back
                    </Button>
                    <Button
                      disabled={busy || !preview.names.length}
                      onClick={() =>
                        void perform(async () => {
                          await api("import_project_configuration", {
                            projectId: project.id,
                            path,
                            target,
                            names: preview.names,
                            overwrite,
                          });
                          setPreview(null);
                          setPath("");
                          toast.success("Import complete");
                        })
                      }
                    >
                      Import {preview.names.length} name
                      {preview.names.length === 1 ? "" : "s"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </SettingBlock>
      <AlertDialog
        open={!!remove}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            nameInput.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {remove?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the saved value and its project grant. The
              application cannot recover it. Active runs already using the
              secret continue with their private copy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep secret</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                const selected = remove;
                if (selected)
                  void perform(async () => {
                    await api("delete_project_secret", {
                      projectId: project.id,
                      name: selected.name,
                    });
                    setRemove(null);
                  });
              }}
            >
              Delete secret
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
