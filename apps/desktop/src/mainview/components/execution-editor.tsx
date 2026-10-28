import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Download,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { subscribeEvents } from "@/lib/events";
import { fail } from "./common";
import {
  imageReferenceSchema,
  type ExecutionOptions,
  type ExecutionResults,
  type ImageResolution,
  type ResolvedExecution,
  type Workflow,
} from "../../shared/contracts";

/**
 * One editable layer on top of inherited values. Global settings sit on the
 * built-in defaults; project settings sit on global settings and .actrc files.
 * Only values that differ from the inherited layer are kept as overrides.
 */
export type Layers = {
  base: ResolvedExecution;
  overrides: ExecutionOptions;
  sourceOf: (key: string) => string;
  scope: "project" | "global";
  onChange: (next: ExecutionOptions) => void;
};
type FieldKey = Exclude<
  keyof ExecutionOptions,
  "runnerMappings" | "secretNames"
>;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export function effectiveOf({ base, overrides }: Layers): ResolvedExecution {
  const { runnerMappings, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    runnerMappings: { ...base.runnerMappings, ...runnerMappings },
  };
}
function setField<K extends FieldKey>(
  layers: Layers,
  key: K,
  value: ExecutionOptions[K],
) {
  const next = { ...layers.overrides };
  if (value === undefined || same(value, layers.base[key])) delete next[key];
  else next[key] = value;
  layers.onChange(next);
}
function resetField(layers: Layers, key: FieldKey) {
  const next = { ...layers.overrides };
  delete next[key];
  layers.onChange(next);
}
function setMapping(layers: Layers, label: string, reference: string | null) {
  const mappings = { ...layers.overrides.runnerMappings };
  if (reference === null || reference === layers.base.runnerMappings[label])
    delete mappings[label];
  else mappings[label] = reference;
  const next: ExecutionOptions = { ...layers.overrides, runnerMappings: mappings };
  if (!Object.keys(mappings).length) delete next.runnerMappings;
  layers.onChange(next);
}
/** Labels whose override cannot be saved, so the page can block saving. */
export function invalidMappings(overrides: ExecutionOptions) {
  return Object.entries(overrides.runnerMappings || {})
    .filter(([, ref]) => !imageReferenceSchema.safeParse(ref).success)
    .map(([label]) => label);
}

export function formatBytes(bytes?: number | null) {
  if (bytes == null) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes,
    i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
export function relativeTime(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const days = Math.floor(s / 86400);
  return days < 30
    ? `${days} day${days === 1 ? "" : "s"} ago`
    : new Date(iso).toLocaleDateString();
}

/** Describe where an inherited value comes from in plain words. */
export function sourceLabel(source: string) {
  if (source.startsWith("Config: ")) {
    const path = source.slice(8);
    return { text: `From ${path.split(/[\\/]/).pop()}`, title: path };
  }
  if (source === "Global settings")
    return { text: "From global settings", title: source };
  return { text: "Default", title: "Built-in Act Dock default" };
}
export function SourceTag({
  overridden,
  source,
  scope,
  onReset,
}: {
  overridden: boolean;
  source: string;
  scope: Layers["scope"];
  onReset?: () => void;
}) {
  if (overridden)
    return (
      <span className="source-tag" data-overridden="">
        <span className="source-dot" aria-hidden="true" />
        {scope === "project" ? "Set for this project" : "Customized"}
        {onReset && (
          <button
            type="button"
            className="source-reset"
            onClick={onReset}
            title={`Return to ${sourceLabel(source).text.toLowerCase()}`}
          >
            <RotateCcw className="size-3" />
            Reset
          </button>
        )}
      </span>
    );
  const { text, title } = sourceLabel(source);
  return (
    <span className="source-tag" title={title}>
      {text}
    </span>
  );
}

export function SettingBlock({
  title,
  description,
  aside,
  children,
}: {
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="setting-block">
      <header>
        <div>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}
function LayerBlock({
  layers,
  field,
  title,
  description,
  children,
}: {
  layers: Layers;
  field: FieldKey;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SettingBlock
      title={title}
      description={description}
      aside={
        <SourceTag
          overridden={field in layers.overrides}
          source={layers.sourceOf(field)}
          scope={layers.scope}
          onReset={() => resetField(layers, field)}
        />
      }
    >
      {children}
    </SettingBlock>
  );
}

export function OptionCards<T extends string>({
  name,
  label,
  value,
  onChange,
  options,
}: {
  name: string;
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: {
    value: T;
    title: string;
    description: string;
    note?: string;
  }[];
}) {
  return (
    <div className="option-cards" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label
          key={o.value}
          className="option-card"
          data-checked={value === o.value ? "" : undefined}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <span className="option-radio" aria-hidden="true" />
          <span className="option-text">
            <span className="option-title">
              {o.title}
              {o.note && <span className="option-note">{o.note}</span>}
            </span>
            <span className="option-description">{o.description}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/* ── Runner images ─────────────────────────────────────────────── */

const standardLabel = /^ubuntu-(latest|20\.04|22\.04|24\.04)$/;
export type ImageTier = "medium" | "full" | "custom";
export function imageTier(reference: string): ImageTier {
  const m = reference.match(/^catthehacker\/ubuntu:(act|full)-\d+\.\d+$/);
  return !m ? "custom" : m[1] === "act" ? "medium" : "full";
}
function tierReference(label: string, tier: "medium" | "full") {
  const version = label === "ubuntu-latest" ? "24.04" : label.slice(7);
  return `catthehacker/ubuntu:${tier === "medium" ? "act" : "full"}-${version}`;
}
export const tierCopy: Record<ImageTier, { title: string; text: string }> = {
  medium: {
    title: "Medium",
    text: "Act’s compact image. Common tools, quick to download. Some preinstalled GitHub runner software is missing.",
  },
  full: {
    title: "Full",
    text: "Much closer to GitHub’s hosted runner, with most SDKs preinstalled. A very large download.",
  },
  custom: {
    title: "Custom",
    text: "Any Docker image reference, such as your team’s own runner image.",
  },
};

type JobRef = { workflow: string; job: string };
export type RunnerUsage = {
  /** Jobs grouped by the label Act will use: the first runs-on label with an image. */
  byLabel: Map<string, JobRef[]>;
  /** Jobs with no mapped label. Act skips them. Keyed by their first label. */
  unmapped: Map<string, JobRef[]>;
  dynamic: (JobRef & { label: string })[];
  containerJobs: number;
};
export function runnerUsage(
  workflows: Workflow[],
  mappings: Record<string, string>,
): RunnerUsage {
  const usage: RunnerUsage = {
    byLabel: new Map(),
    unmapped: new Map(),
    dynamic: [],
    containerJobs: 0,
  };
  const add = (map: Map<string, JobRef[]>, key: string, ref: JobRef) =>
    map.set(key, [...(map.get(key) || []), ref]);
  for (const w of workflows)
    for (const j of w.jobs) {
      if (j.uses || !j.runners.length) continue;
      const ref = { workflow: w.name, job: j.name || j.id };
      if (j.container) usage.containerJobs++;
      const labels = j.runners.map((r) => r.toLowerCase());
      const dynamic = labels.find((l) => l.includes("${{"));
      if (dynamic) {
        usage.dynamic.push({ ...ref, label: j.runners.join(", ") });
        continue;
      }
      const mapped = labels.find((l) => mappings[l]);
      if (mapped) add(usage.byLabel, mapped, ref);
      else add(usage.unmapped, labels[0], ref);
    }
  return usage;
}

type ImageOperation = ExecutionResults["list_image_operations"][number];
type ImageState =
  | { status: "checking" }
  | { status: "ready"; info: ImageResolution }
  | { status: "error"; message: string };
/**
 * Inspect each image reference once (debounced while typing) and follow
 * download operations through the shared event stream.
 */
export function useImageStatus(references: string[]) {
  const [states, setStates] = useState<Record<string, ImageState>>({}),
    [operations, setOperations] = useState<ImageOperation[]>([]);
  const previous = useRef<Record<string, string>>({});
  const requested = useRef(new Set<string>());
  const inspect = useCallback(async (reference: string) => {
    requested.current.add(reference);
    setStates((s) => ({ ...s, [reference]: { status: "checking" } }));
    try {
      const info = await api("inspect_image", {
        reference,
        architecture: "auto",
      });
      setStates((s) => ({ ...s, [reference]: { status: "ready", info } }));
    } catch (e) {
      setStates((s) => ({
        ...s,
        [reference]: { status: "error", message: fail(e) },
      }));
    }
  }, []);
  const refreshOperations = useCallback(async () => {
    const list = await api("list_image_operations");
    setOperations(list);
    for (const op of list) {
      if (previous.current[op.id] === "pulling" && op.state !== "pulling") {
        if (op.state === "complete") toast.success(`Downloaded ${op.reference}`);
        void inspect(op.reference);
      }
      previous.current[op.id] = op.state;
    }
  }, [inspect]);
  const valid = useMemo(
    () =>
      [...new Set(references)]
        .filter((r) => imageReferenceSchema.safeParse(r).success)
        .sort(),
    [references.join("\n")],
  );
  useEffect(() => {
    // Inspect in parallel: a registry lookup for a missing image must not hold up local ones.
    const timer = setTimeout(() => {
      for (const reference of valid)
        if (!requested.current.has(reference)) void inspect(reference);
    }, 450);
    return () => clearTimeout(timer);
  }, [valid, inspect]);
  useEffect(() => {
    void refreshOperations().catch(() => {});
    return subscribeEvents((events) => {
      if (events.some((e) => e.kind === "image"))
        void refreshOperations().catch(() => {});
    });
  }, [refreshOperations]);
  const pulling = operations.some((o) => o.state === "pulling");
  useEffect(() => {
    if (!pulling) return;
    const timer = setInterval(
      () => void refreshOperations().catch(() => {}),
      1500,
    );
    return () => clearInterval(timer);
  }, [pulling, refreshOperations]);
  return {
    states,
    inspect,
    operation: (reference: string) =>
      operations.filter((o) => o.reference === reference).pop(),
    async pull(reference: string) {
      try {
        await api("pull_image", { reference, architecture: "auto" });
        await refreshOperations();
      } catch (e) {
        toast.error(fail(e));
      }
    },
    async cancel(id: string) {
      await api("cancel_image_pull", { operationId: id }).catch(() => {});
      await refreshOperations().catch(() => {});
    },
    recheckAll() {
      for (const reference of valid) void inspect(reference);
    },
  };
}
type ImageStatusApi = ReturnType<typeof useImageStatus>;

function ImageStatusLine({
  reference,
  images,
}: {
  reference: string;
  images: ImageStatusApi;
}) {
  if (!imageReferenceSchema.safeParse(reference).success)
    return (
      <p className="image-status" data-tone="error" role="alert">
        <CircleAlert className="size-3.5" />
        Enter a Docker image reference, like registry.example/team/runner:tag
      </p>
    );
  const state = images.states[reference],
    op = images.operation(reference);
  if (op?.state === "pulling")
    return (
      <div className="image-status" data-tone="busy">
        <LoaderCircle className="size-3.5 animate-spin" />
        <span>
          Downloading
          {op.detail ? ` · ${op.detail.replace(/\s*\[.*$/, "")}` : "…"}
        </span>
        {op.fraction !== undefined && (
          <span
            className="image-progress"
            role="progressbar"
            aria-valuenow={Math.round(op.fraction * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${op.fraction * 100}%` }} />
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => void images.cancel(op.id)}
        >
          <X className="size-3.5" />
          Cancel
        </Button>
      </div>
    );
  if (!state || state.status === "checking")
    return (
      <p className="image-status" data-tone="muted">
        <LoaderCircle className="size-3.5 animate-spin" />
        Checking image…
      </p>
    );
  if (state.status === "error")
    return (
      <div className="image-status" data-tone="error">
        <CircleAlert className="size-3.5" />
        <span>{state.message}</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => void images.inspect(reference)}
        >
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      </div>
    );
  const { info } = state;
  const failed = op?.state === "failed" && !info.available;
  return (
    <div
      className="image-status"
      data-tone={info.available ? "ready" : failed ? "error" : "muted"}
    >
      {info.available ? (
        <CircleCheck className="size-3.5" />
      ) : failed ? (
        <CircleAlert className="size-3.5" />
      ) : (
        <CircleDashed className="size-3.5" />
      )}
      <span>
        {info.available
          ? ["Downloaded", formatBytes(info.bytes), info.platform]
              .filter(Boolean)
              .join(" · ")
          : failed
            ? "Download failed. Check Docker and registry access."
            : [
                "Not downloaded",
                info.downloadBytes &&
                  `${formatBytes(info.downloadBytes)} to download`,
                info.platform,
              ]
                .filter(Boolean)
                .join(" · ")}
      </span>
      {!info.available ? (
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => void images.pull(reference)}
        >
          <Download className="size-3.5" />
          {failed ? "Try again" : "Download now"}
        </Button>
      ) : (
        <button
          type="button"
          className="image-recheck"
          onClick={() => void images.inspect(reference)}
          aria-label={`Check ${reference} again`}
          title="Check again"
        >
          <RefreshCw className="size-3" />
        </button>
      )}
    </div>
  );
}

function TierPicker({
  label,
  tier,
  onPick,
}: {
  label: string;
  tier: ImageTier;
  onPick: (t: ImageTier) => void;
}) {
  return (
    <div className="tier-picker" role="radiogroup" aria-label={`Image for ${label}`}>
      {(["medium", "full", "custom"] as const).map((t) => (
        <label key={t} data-checked={tier === t ? "" : undefined} title={tierCopy[t].text}>
          <input
            type="radio"
            name={`tier-${label}`}
            checked={tier === t}
            onChange={() => onPick(t)}
          />
          {tierCopy[t].title}
        </label>
      ))}
    </div>
  );
}

function JobList({ jobs }: { jobs: JobRef[] }) {
  const [open, setOpen] = useState(false);
  const shown = open ? jobs : jobs.slice(0, 3);
  return (
    <p className="image-jobs">
      <span>
        Used by {jobs.length} job{jobs.length === 1 ? "" : "s"}:
      </span>{" "}
      {shown.map((j, i) => (
        <span key={`${j.workflow}/${j.job}/${i}`} className="image-job">
          {j.workflow} <span aria-hidden="true">›</span> {j.job}
        </span>
      ))}
      {jobs.length > 3 && (
        <button type="button" onClick={() => setOpen(!open)}>
          {open ? "Show less" : `+${jobs.length - 3} more`}
        </button>
      )}
    </p>
  );
}

function ImageRow({
  layers,
  label,
  jobs,
  images,
}: {
  layers: Layers;
  label: string;
  jobs?: JobRef[];
  images: ImageStatusApi;
}) {
  const reference = effectiveOf(layers).runnerMappings[label] ?? "",
    standard = standardLabel.test(label),
    overridden = label in (layers.overrides.runnerMappings || {}),
    inherited = label in layers.base.runnerMappings;
  const [customMode, setCustomMode] = useState(
    () => !standard || imageTier(reference) === "custom",
  );
  const tier: ImageTier = customMode ? "custom" : imageTier(reference);
  return (
    <li className="image-row" data-unused={jobs ? undefined : ""}>
      <div className="image-row-head">
        <div className="image-label">
          <code>{label}</code>
          {label === "ubuntu-20.04" && (
            <span className="image-flag">Legacy</span>
          )}
          {jobs && (
            <span className="image-flag" data-strong="">
              In use
            </span>
          )}
        </div>
        <div className="image-row-actions">
          {inherited ? (
            <SourceTag
              overridden={overridden}
              source={layers.sourceOf(`runnerMappings.${label}`)}
              scope={layers.scope}
              onReset={() => {
                setMapping(layers, label, null);
                setCustomMode(
                  !standard ||
                    imageTier(layers.base.runnerMappings[label]) === "custom",
                );
              }}
            />
          ) : (
            <span className="source-tag" data-overridden="">
              <span className="source-dot" aria-hidden="true" />
              {layers.scope === "project" ? "Added for this project" : "Added"}
            </span>
          )}
          {!inherited && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Remove mapping for ${label}`}
              title="Remove mapping"
              onClick={() => setMapping(layers, label, null)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className="image-row-body">
        {standard && (
          <TierPicker
            label={label}
            tier={tier}
            onPick={(t) => {
              if (t === "custom") return setCustomMode(true);
              setCustomMode(false);
              setMapping(layers, label, tierReference(label, t));
            }}
          />
        )}
        {tier === "custom" ? (
          <Input
            aria-label={`Docker image for ${label}`}
            className="mono image-input"
            value={reference}
            spellCheck={false}
            autoComplete="off"
            placeholder="registry.example/team/runner:tag"
            aria-invalid={
              !imageReferenceSchema.safeParse(reference).success || undefined
            }
            onChange={(e) => setMapping(layers, label, e.target.value.trim())}
          />
        ) : (
          <code className="image-reference" title={reference}>
            {reference}
          </code>
        )}
      </div>
      <ImageStatusLine reference={reference} images={images} />
      {jobs && <JobList jobs={jobs} />}
    </li>
  );
}

function AddMapping({
  layers,
  existing,
  initialLabel = "",
  onDone,
}: {
  layers: Layers;
  existing: string[];
  initialLabel?: string;
  onDone?: () => void;
}) {
  const [label, setLabel] = useState(initialLabel),
    [reference, setReference] = useState("");
  const normalized = label.trim().toLowerCase();
  const labelError = !normalized
    ? ""
    : !/^[a-z0-9][a-z0-9._-]*$/.test(normalized)
      ? "Use letters, numbers, dots, dashes or underscores."
      : existing.includes(normalized)
        ? "This label already has an image. Edit it above."
        : "";
  const referenceError =
    reference && !imageReferenceSchema.safeParse(reference.trim()).success
      ? "Use a Docker image reference without credentials."
      : "";
  return (
    <form
      className="add-mapping"
      onSubmit={(e) => {
        e.preventDefault();
        if (!normalized || !reference || labelError || referenceError) return;
        setMapping(layers, normalized, reference.trim());
        setLabel("");
        setReference("");
        onDone?.();
      }}
    >
      <div className="field">
        <Label htmlFor={`add-label-${layers.scope}`}>runs-on label</Label>
        <Input
          id={`add-label-${layers.scope}`}
          className="mono"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="my-linux-runner"
          aria-invalid={!!labelError || undefined}
        />
      </div>
      <div className="field">
        <Label htmlFor={`add-ref-${layers.scope}`}>Docker image</Label>
        <Input
          id={`add-ref-${layers.scope}`}
          className="mono"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="registry.example/team/runner:tag"
          aria-invalid={!!referenceError || undefined}
        />
      </div>
      <Button
        type="submit"
        variant="outline"
        disabled={!normalized || !reference || !!labelError || !!referenceError}
      >
        <Plus className="size-3.5" />
        Add
      </Button>
      {(labelError || referenceError) && (
        <p className="form-hint" role="alert">
          {labelError || referenceError}
        </p>
      )}
    </form>
  );
}

export function RunnerImagesPanel({
  layers,
  workflows,
}: {
  layers: Layers;
  workflows?: Workflow[];
}) {
  const effective = effectiveOf(layers);
  const mappings = effective.runnerMappings;
  const usage = workflows ? runnerUsage(workflows, mappings) : null;
  const used = usage ? [...usage.byLabel.keys()].sort() : [];
  const others = Object.keys(mappings)
    .filter((l) => !used.includes(l))
    .sort((a, b) =>
      standardLabel.test(a) === standardLabel.test(b)
        ? a.localeCompare(b)
        : standardLabel.test(a)
          ? -1
          : 1,
    );
  const images = useImageStatus(
    (usage ? used : Object.keys(mappings)).map((l) => mappings[l]),
  );
  const [adding, setAdding] = useState<string | null>(null);
  const usedRefs = [...new Set(used.map((l) => mappings[l]))];
  const ready = usedRefs.filter((r) => {
    const s = images.states[r];
    return s?.status === "ready" && s.info.available;
  });
  const disk = ready.reduce((sum, r) => {
    const s = images.states[r];
    return sum + (s?.status === "ready" ? s.info.bytes || 0 : 0);
  }, 0);
  return (
    <div className="tab-stack">
      {usage && (
        <div className="image-summary">
          <div>
            <span>Labels in use</span>
            <strong>{used.length}</strong>
          </div>
          <div>
            <span>Images downloaded</span>
            <strong>
              {ready.length}
              <small> of {usedRefs.length}</small>
            </strong>
          </div>
          <div>
            <span>On disk</span>
            <strong>{formatBytes(disk) || "—"}</strong>
          </div>
          <div>
            <span>Image downloads</span>
            <strong className="image-summary-text">
              {
                {
                  "if-missing": "When missing",
                  always: "Every run",
                  never: "Never",
                }[effective.imagePullPolicy]
              }
            </strong>
          </div>
        </div>
      )}
      <dl className="tier-legend">
        {(["medium", "full", "custom"] as const).map((t) => (
          <div key={t}>
            <dt>{tierCopy[t].title}</dt>
            <dd>{tierCopy[t].text}</dd>
          </div>
        ))}
      </dl>
      {usage && (
        <SettingBlock
          title="Used by this project"
          description={
            <>
              Act starts each job in the image mapped to its{" "}
              <code>runs-on</code> label. These are the images this project’s
              workflows use right now.
            </>
          }
        >
          {used.length ? (
            <ul className="image-list">
              {used.map((label) => (
                <ImageRow
                  key={label}
                  layers={layers}
                  label={label}
                  jobs={usage.byLabel.get(label)}
                  images={images}
                />
              ))}
            </ul>
          ) : (
            <p className="quiet-empty">
              No workflow jobs in this project use a mapped runner label.
            </p>
          )}
          {[...usage.unmapped].map(([label, jobs]) => (
            <div className="image-warning" key={label} role="note">
              <CircleAlert className="size-4" />
              <div>
                <strong>
                  <code>{label}</code> has no image
                </strong>
                <p>
                  Act will skip {jobs.length} job{jobs.length === 1 ? "" : "s"}{" "}
                  ({jobs.map((j) => j.job).join(", ")}). Map this label to a
                  Linux image to run {jobs.length === 1 ? "it" : "them"}{" "}
                  locally.
                </p>
                {adding === label ? (
                  <AddMapping
                    layers={layers}
                    existing={Object.keys(mappings)}
                    initialLabel={label}
                    onDone={() => setAdding(null)}
                  />
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAdding(label)}
                  >
                    <Plus className="size-3.5" />
                    Map an image
                  </Button>
                )}
              </div>
            </div>
          ))}
          {(usage.dynamic.length > 0 || usage.containerJobs > 0) && (
            <ul className="image-notes">
              {usage.dynamic.length > 0 && (
                <li>
                  {usage.dynamic.length} job
                  {usage.dynamic.length === 1 ? " picks its" : "s pick their"}{" "}
                  runner from an expression (
                  <code>{usage.dynamic[0].label}</code>), so the image is
                  chosen when the run starts.
                </li>
              )}
              {usage.containerJobs > 0 && (
                <li>
                  {usage.containerJobs} job
                  {usage.containerJobs === 1 ? " declares" : "s declare"} a{" "}
                  <code>container:</code>. Their steps run in that image
                  instead.
                </li>
              )}
            </ul>
          )}
        </SettingBlock>
      )}
      <SettingBlock
        title={usage ? "Other labels" : "Label mappings"}
        description={
          usage
            ? "Mappings no workflow in this project uses yet. They apply as soon as a job targets the label."
            : "Every project inherits these mappings unless it changes them."
        }
      >
        {usage ? (
          <OtherLabels layers={layers} labels={others} />
        ) : (
          <ul className="image-list">
            {others.map((label) => (
              <ImageRow
                key={label}
                layers={layers}
                label={label}
                images={images}
              />
            ))}
          </ul>
        )}
        <div className="add-mapping-wrap">
          <h4>Add a custom label</h4>
          <AddMapping layers={layers} existing={Object.keys(mappings)} />
        </div>
      </SettingBlock>
      <LayerBlock
        layers={layers}
        field="imagePullPolicy"
        title="When to download images"
        description="Missing images are downloaded before a run starts."
      >
        <OptionCards
          name={`pull-${layers.scope}`}
          label="When to download images"
          value={effective.imagePullPolicy}
          onChange={(v) => setField(layers, "imagePullPolicy", v)}
          options={[
            {
              value: "if-missing",
              title: "Only when missing",
              description:
                "Use the local copy when there is one. Fastest start.",
              note: "Recommended",
            },
            {
              value: "always",
              title: "Before every run",
              description:
                "Check the registry each run to pick up updated tags. Slower.",
            },
            {
              value: "never",
              title: "Never",
              description:
                "Work offline. Runs wait in the queue if an image is missing.",
            },
          ]}
        />
      </LayerBlock>
    </div>
  );
}

/** Compact, editable list for labels the project does not use. */
function OtherLabels({ layers, labels }: { layers: Layers; labels: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const images = useImageStatus(open ? [effectiveOf(layers).runnerMappings[open]] : []);
  const mappings = effectiveOf(layers).runnerMappings;
  return (
    <ul className="other-labels">
      {labels.map((label) =>
        open === label ? (
          <li key={label} className="other-label-open">
            <ul className="image-list">
              <ImageRow layers={layers} label={label} images={images} />
            </ul>
            <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
              Done
            </Button>
          </li>
        ) : (
          <li key={label}>
            <button type="button" onClick={() => setOpen(label)}>
              <code className="other-label">{label}</code>
              <span className="image-tier" data-tier={imageTier(mappings[label])}>
                {tierCopy[imageTier(mappings[label])].title}
              </span>
              <code className="other-reference">{mappings[label]}</code>
              {label in (layers.overrides.runnerMappings || {}) && (
                <span className="source-dot" aria-label="Changed" />
              )}
              <span className="other-edit">Edit</span>
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

/* ── Run behavior ──────────────────────────────────────────────── */

export function RunBehaviorPanel({
  layers,
  children,
}: {
  layers: Layers;
  children?: ReactNode;
}) {
  const effective = effectiveOf(layers);
  const reservation = effective.reservation;
  return (
    <div className="tab-stack">
      <LayerBlock
        layers={layers}
        field="workspaceMode"
        title="Project files"
        description="How your working tree reaches the job containers."
      >
        <OptionCards
          name={`workspace-${layers.scope}`}
          label="Project files"
          value={effective.workspaceMode}
          onChange={(v) => setField(layers, "workspaceMode", v)}
          options={[
            {
              value: "copy",
              title: "Copy into each run",
              description:
                "Every run starts from a fresh copy of your current files. Your folder is never modified.",
              note: "Recommended",
            },
            {
              value: "bind",
              title: "Mount the folder directly",
              description:
                "Faster for large repositories, but workflow commands can change or delete your files.",
            },
          ]}
        />
      </LayerBlock>
      <LayerBlock
        layers={layers}
        field="concurrentJobs"
        title="Parallel jobs inside a run"
        description="How many jobs from one workflow Act may run at the same time."
      >
        <div className="inline-control">
          <Switch
            id={`auto-jobs-${layers.scope}`}
            checked={effective.concurrentJobs === undefined}
            onCheckedChange={(auto) =>
              setField(layers, "concurrentJobs", auto ? undefined : 2)
            }
          />
          <Label htmlFor={`auto-jobs-${layers.scope}`}>
            Automatic (Act decides, based on CPU count)
          </Label>
          {effective.concurrentJobs !== undefined && (
            <div className="stepper">
              <Input
                type="number"
                min={1}
                max={64}
                aria-label="Parallel jobs"
                value={effective.concurrentJobs}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  if (n >= 1 && n <= 64) setField(layers, "concurrentJobs", n);
                }}
              />
              <span>jobs</span>
            </div>
          )}
        </div>
      </LayerBlock>
      <LayerBlock
        layers={layers}
        field="reservation"
        title="Scheduling reservation"
        description="What Act Dock sets aside for each run when deciding whether another run can start. These are not container limits."
      >
        <div className="reservation-grid">
          {(["cpus", "memoryGiB"] as const).map((key) => (
            <div className="field" key={key}>
              <Label htmlFor={`reserve-${key}-${layers.scope}`}>
                {key === "cpus" ? "CPUs" : "Memory"}
              </Label>
              <div className="stepper">
                <Input
                  id={`reserve-${key}-${layers.scope}`}
                  type="number"
                  min={0.25}
                  step={0.25}
                  value={reservation[key]}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (n > 0)
                      setField(layers, "reservation", {
                        ...reservation,
                        [key]: n,
                      });
                  }}
                />
                <span>{key === "cpus" ? "cores" : "GiB"}</span>
              </div>
            </div>
          ))}
        </div>
      </LayerBlock>
      {children}
    </div>
  );
}

/* ── Caches ────────────────────────────────────────────────────── */

const packageCopy = {
  npm: {
    title: "npm",
    text: "Keeps downloaded packages between runs. node_modules is still installed fresh.",
  },
  pnpm: {
    title: "pnpm",
    text: "Keeps the pnpm content store between runs.",
  },
  bun: {
    title: "Bun",
    text: "Keeps Bun’s install cache between runs.",
  },
} as const;

export function CachePolicyPanel({
  layers,
  children,
}: {
  layers: Layers;
  children?: ReactNode;
}) {
  const effective = effectiveOf(layers);
  return (
    <div className="tab-stack">
      <LayerBlock
        layers={layers}
        field="actionCachePolicy"
        title="Action sources"
        description={
          <>
            How actions referenced with <code>uses:</code> are fetched.
          </>
        }
      >
        <OptionCards
          name={`actions-${layers.scope}`}
          label="Action sources"
          value={effective.actionCachePolicy}
          onChange={(v) => setField(layers, "actionCachePolicy", v)}
          options={[
            {
              value: "cache-first",
              title: "Cache first",
              description:
                "Reuse downloaded actions and check branches and tags for updates once a day.",
              note: "Recommended",
            },
            {
              value: "refresh",
              title: "Refresh every run",
              description:
                "Always fetch the latest action source. Slowest, always current.",
            },
            {
              value: "cached-only",
              title: "Cached only",
              description:
                "Never fetch. Runs fail if an action has not been downloaded before.",
            },
          ]}
        />
      </LayerBlock>
      <LayerBlock
        layers={layers}
        field="packageCaches"
        title="Package download caches"
        description="Keep package manager downloads in a private volume for this project, so repeat installs are faster."
      >
        <ul className="toggle-list">
          {(["npm", "pnpm", "bun"] as const).map((kind) => {
            const on = effective.packageCaches.includes(kind);
            return (
              <li key={kind}>
                <div>
                  <Label htmlFor={`pkg-${kind}-${layers.scope}`}>
                    {packageCopy[kind].title}
                  </Label>
                  <p>{packageCopy[kind].text}</p>
                  {kind === "pnpm" && on && (
                    <p className="toggle-note">
                      Point your workflow at it:{" "}
                      <code>pnpm install --store-dir /var/cache/act-dock/pnpm</code>
                    </p>
                  )}
                </div>
                <Switch
                  id={`pkg-${kind}-${layers.scope}`}
                  checked={on}
                  onCheckedChange={(checked) =>
                    setField(
                      layers,
                      "packageCaches",
                      (["npm", "pnpm", "bun"] as const).filter((k) =>
                        k === kind ? checked : effective.packageCaches.includes(k),
                      ),
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
      </LayerBlock>
      {children}
    </div>
  );
}
