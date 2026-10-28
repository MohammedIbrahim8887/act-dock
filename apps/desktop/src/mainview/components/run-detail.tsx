import { queueReasonText } from "../../shared/queue-reasons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Copy,
  Download,
  RotateCcw,
  Square,
  Search,
  ArrowDown,
  Terminal,
  ChevronLeft,
  LoaderCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { subscribeEvents } from "@/lib/events";
import { api, exportLogs } from "@/lib/api";
import {
  activeStates,
  type LogEntry,
  type Run,
  type RunMetric,
} from "../../shared/contracts";
import {
  advanceProgress,
  currentSteps,
  isCurrentStepLine,
  type RunProgress,
} from "../../shared/run-progress";
import { Empty, Status, IconButton, duration, fail } from "./common";
export function RunDetail({
  run,
  onRun,
  onBack,
}: {
  run: Run | null;
  onRun: (r: Run) => void;
  onBack: () => void;
}) {
  const [logs, setLogs] = useState<LogEntry[]>([]),
    [filter, setFilter] = useState(""),
    [follow, setFollow] = useState(true),
    [tab, setTab] = useState("logs"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    runId: string;
    steps: RunProgress;
  }>({ runId: "", steps: {} });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const attachViewport = useCallback(
    (node: HTMLDivElement | null) => {
      viewportRef.current = node;
      if (node && follow) node.scrollTop = node.scrollHeight;
    },
    [follow],
  );
  const cursor = useRef(0);
  const [metrics, setMetrics] = useState<RunMetric[]>([]),
    [resupply, setResupply] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    let next = 0;
    setMetrics([]);
    setResupply({});
    let pending = false;
    const read = async () => {
      if (!run || pending) return;
      pending = true;
      try {
        const page = await api("get_run_metrics", {
          runId: run.id,
          cursor: next,
          limit: 500,
        });
        if (alive) {
          next = page.nextCursor;
          setMetrics((previous) => [...previous, ...page.entries].slice(-500));
        }
      } catch {
      } finally {
        pending = false;
      }
    };
    const unsubscribe = subscribeEvents((events) => {
      if (
        !events.length ||
        events.some((e) => e.kind === "metrics" && e.runId === run?.id)
      )
        void read();
    });
    void read();
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [run?.id]);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let fetching = false,
      again = false;
    cursor.current = 0;
    setLogs([]);
    setProgress({ runId: run?.id || "", steps: {} });
    setError("");
    setFollow(true);
    setTab("logs");
    async function poll() {
      if (!run) return;
      if (fetching) {
        again = true;
        return;
      }
      fetching = true;
      try {
        const page = await api("get_run_logs", {
          runId: run.id,
          cursor: cursor.current,
          limit: 1000,
        });
        if (!alive) return;
        cursor.current = page.nextCursor;
        setLogs((prev) => [...prev, ...page.entries].slice(-2000));
        setProgress((prev) => ({
          runId: run.id,
          steps: advanceProgress(prev.steps, page.entries),
        }));
        setError("");
        if (!page.end && page.entries.length === 1000) again = true;
      } catch (e) {
        if (alive) {
          setError(fail(e));
          timer = setTimeout(() => void poll(), 3000);
        }
      } finally {
        fetching = false;
        if (again && alive) {
          again = false;
          void poll();
        }
      }
    }
    const unsubscribe = subscribeEvents((events) => {
      if (
        events.some(
          (e) =>
            e.runId === run?.id && ["logs", "run", "step"].includes(e.kind),
        )
      )
        void poll();
    });
    void poll();
    return () => {
      alive = false;
      unsubscribe();
      clearTimeout(timer);
    };
  }, [run?.id]);
  useEffect(() => {
    if (follow) {
      const viewport = viewportRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }
  }, [logs, follow, tab]);
  if (!run)
    return (
      <section className="run-pane">
        <Empty
          title="Every run, in view"
          description="Choose a workflow to start a run. Its output and result will appear here."
          icon={<Terminal className="size-6" />}
        />
      </section>
    );
  const visible = logs.filter(
    (l) => !filter || l.message.toLowerCase().includes(filter.toLowerCase()),
  );
  const steps =
    run.state === "running" && progress.runId === run.id
      ? currentSteps(progress.steps)
      : [];
  async function action(kind: "cancel" | "rerun") {
    setBusy(true);
    try {
      const result =
        kind === "cancel"
          ? await api("cancel_run", { runId: run!.id })
          : await api("run_pipeline", {
              ...run!.request,
              idempotencyKey: undefined,
            });
      onRun(result);
      toast.success(
        kind === "cancel" ? "Cancellation requested" : "Run queued",
      );
    } catch (e) {
      toast.error(fail(e));
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        visible.map((l) => l.message).join("\n"),
      );
      toast.success("Visible logs copied");
    } catch {
      toast.error("Clipboard unavailable. Export the logs instead.");
    }
  }
  return (
    <section className="run-pane">
      <header className="run-header">
        <div className="run-heading">
          <Button
            className="narrow-back"
            variant="ghost"
            size="icon"
            aria-label="Back to workflows"
            onClick={onBack}
          >
            <ChevronLeft />
          </Button>
          <div className="min-w-0">
            <h2>{run.request.workflowPath.split("/").pop()}</h2>
            <p>
              {run.projectName}
              <span> / </span>
              {run.request.jobId || "All jobs"}
            </p>
          </div>
          <Status state={run.state} />
          {run.phase && activeStates.includes(run.state) && (
            <span role="status">{run.phase}</span>
          )}
          {run.queueReason && (
            <p role="status" className="field-help">
              Waiting: {queueReasonText(run.queueReason)}
            </p>
          )}
        </div>
        <div className="run-metadata">
          <span title={run.createdAt}>
            {new Date(run.createdAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span>{duration(run.startedAt, run.finishedAt)}</span>
          <span className="capitalize">{run.source}</span>
          <span className="mono">{run.id.slice(0, 8)}</span>
        </div>
      </header>
      <Tabs value={tab} onValueChange={setTab} className="run-tabs">
        <div className="run-tab-bar">
          <TabsList variant="line">
            <TabsTrigger value="logs">Output</TabsTrigger>
            <TabsTrigger value="details">Run details</TabsTrigger>
          </TabsList>
          {activeStates.includes(run.state) ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || run.state === "cancelling"}
              onClick={() => void action("cancel")}
            >
              <Square className="size-3" />
              {run.state === "cancelling" ? "Cancelling…" : "Cancel run"}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void action("rerun")}
            >
              <RotateCcw className="size-3" />
              Run again
            </Button>
          )}
        </div>
        <TabsContent value="logs" className="log-tab">
          {run.state === "running" && (
            <div
              className="run-progress"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <div className="run-progress-label">
                <LoaderCircle
                  className="size-3.5 animate-spin"
                  aria-hidden="true"
                />
                {steps.length > 1 ? "Current steps" : "Current step"}
              </div>
              <ScrollArea className="run-progress-scroll">
                <div className="run-progress-steps">
                  {steps.length ? (
                    steps.map((step) => (
                      <div className="run-progress-step" key={step.jobKey}>
                        {step.job && (
                          <span className="run-progress-job mono">
                            {step.job}
                          </span>
                        )}
                        <span className="run-progress-name" title={step.name}>
                          {step.name.replace(/^Main\s+/, "")}
                        </span>
                      </div>
                    ))
                  ) : (
                    <span className="run-progress-wait">
                      {logs.length
                        ? "Preparing the next step…"
                        : "Preparing workflow…"}
                    </span>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
          <div className="log-toolbar">
            <div className="search-input">
              <Search className="size-3.5" />
              <Input
                aria-label="Search latest retained output (up to 2,000 lines)"
                placeholder="Find in latest 2,000 lines…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <IconButton label="Copy visible output" onClick={() => void copy()}>
              <Copy className="size-4" />
            </IconButton>
            <IconButton
              label="Export complete logs"
              onClick={() =>
                void exportLogs(run.id)
                  .then((path) => {
                    if (path) toast.success("Logs exported to " + path);
                  })
                  .catch((e) => toast.error(fail(e)))
              }
            >
              <Download className="size-4" />
            </IconButton>
          </div>
          {run.diagnostic && (
            <div className="run-diagnostic" role="alert">
              {run.diagnostic}
            </div>
          )}
          {error && (
            <div className="run-diagnostic" role="alert">
              {error} Reconnecting…
            </div>
          )}
          <ScrollArea
            className="log-scroll"
            viewportRef={attachViewport}
            viewportLabel="Scrollable pipeline output"
            onViewportScroll={(event) => {
              const viewport = event.currentTarget;
              if (
                viewport.scrollHeight -
                  viewport.scrollTop -
                  viewport.clientHeight >
                48
              )
                setFollow(false);
            }}
          >
            <div
              className="log-lines"
              role="log"
              aria-label="Pipeline output"
              aria-live="off"
            >
              {visible.map((l) => (
                <div
                  className={`log-line ${isCurrentStepLine(l, steps) ? "is-current-step" : ""}`}
                  key={l.cursor}
                >
                  <span className="line-number">{l.cursor}</span>
                  <code>
                    {l.job && <span className="log-job">[{l.job}] </span>}
                    {l.message || " "}
                  </code>
                </div>
              ))}
              {!logs.length && !error && (
                <div className="log-wait">
                  {activeStates.includes(run.state)
                    ? "Waiting for output…"
                    : "This run has no output."}
                </div>
              )}
              {filter && !visible.length && logs.length > 0 && (
                <div className="log-wait">
                  No matches in retained output. Export complete logs to search
                  earlier lines.
                </div>
              )}
            </div>
          </ScrollArea>
          <div className="log-footer">
            <span>
              {logs.length === 2000
                ? "Latest 2,000"
                : logs.length.toLocaleString()}{" "}
              lines{filter ? ` · ${visible.length} matches` : ""}
            </span>
            <Button
              variant={follow ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setFollow((v) => !v)}
            >
              <ArrowDown className="size-3" />
              {follow ? "Following output" : "Follow output"}
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="details" className="details-tab">
          {run.queueReason === "secret-input-required" && (
            <div className="field-stack">
              <h3>Re-enter one-run secrets</h3>
              <p className="field-help">
                The runner restarted before admission. The unsaved values were
                discarded.
              </p>
              {(run.ephemeralSecretNames || []).map((name) => (
                <div className="field" key={name}>
                  <label htmlFor={`resupply-${name}`}>{name}</label>
                  <Input
                    id={`resupply-${name}`}
                    type="password"
                    autoComplete="off"
                    value={resupply[name] || ""}
                    onChange={(e) =>
                      setResupply((values) => ({
                        ...values,
                        [name]: e.target.value,
                      }))
                    }
                  />
                </div>
              ))}
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api("supply_run_secrets", {
                      runId: run.id,
                      values: resupply,
                    });
                    setResupply({});
                    toast.success("Secret input supplied");
                  } catch (e) {
                    toast.error(fail(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Resume queued run
              </Button>
            </div>
          )}
          {metrics.length > 0 && (
            <div className="field-stack">
              <h3>Container metrics</h3>
              {metrics.slice(-4).map((metric) => (
                <p className="field-help" key={metric.cursor}>
                  <code>{metric.containerId.slice(0, 12)}</code> ·{" "}
                  {metric.cpuPercent?.toFixed(1) ?? "Unknown"}% CPU ·{" "}
                  {metric.memoryBytes === null
                    ? "Memory unknown"
                    : `${(metric.memoryBytes / 1024 ** 2).toFixed(1)} MiB`}
                </p>
              ))}
            </div>
          )}
          <dl className="detail-list">
            <dt>Run ID</dt>
            <dd className="mono">{run.id}</dd>
            <dt>Project</dt>
            <dd className="mono">{run.projectPath}</dd>
            <dt>Workflow</dt>
            <dd className="mono">{run.request.workflowPath}</dd>
            <dt>Event</dt>
            <dd>{run.request.event}</dd>
            <dt>Jobs</dt>
            <dd>{run.request.jobId || "All jobs"}</dd>
            <dt>Source</dt>
            <dd>{run.source}</dd>
            <dt>Exit code</dt>
            <dd>{run.exitCode ?? "—"}</dd>
            <dt>Created</dt>
            <dd>{new Date(run.createdAt).toLocaleString()}</dd>
            <dt>Started</dt>
            <dd>
              {run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}
            </dd>
            <dt>Finished</dt>
            <dd>
              {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "—"}
            </dd>
          </dl>
          <Separator />
          {run.snapshot && (
            <details className="mt-5">
              <summary>Frozen execution configuration</summary>
              <dl className="detail-list">
                <dt>Engine</dt>
                <dd>
                  {run.snapshot.engine?.version || "Resolved at admission"}
                </dd>
                <dt>Selected secret names</dt>
                <dd>{run.snapshot.secretNames.join(", ") || "None"}</dd>
                <dt>Image policy</dt>
                <dd>{run.snapshot.options.imagePullPolicy}</dd>
                <dt>Action sources</dt>
                <dd>{run.snapshot.options.actionCachePolicy}</dd>
                {run.snapshot.images.map((image) => (
                  <div key={image.reference}>
                    <dt>{image.platform}</dt>
                    <dd className="technical-wrap">{image.resolved}</dd>
                  </div>
                ))}
              </dl>
              <pre className="command-block">
                {JSON.stringify(run.snapshot, null, 2)}
              </pre>
            </details>
          )}
          <h3 className="mt-5 mb-2">Invocation</h3>
          <p className="field-help mb-3">
            act also reads your global and project .actrc files.
          </p>
          <pre className="command-block">
            {run.command
              .map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))
              .join(" ")}
          </pre>
        </TabsContent>
      </Tabs>
    </section>
  );
}
