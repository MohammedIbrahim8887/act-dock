import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  History,
  ListFilter,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Choice } from "./run-dialog";
import { Empty, Status, duration, fail } from "./common";
import { api } from "@/lib/api";
import { runStates, type HistoryPage, type Run } from "../../shared/contracts";

export type HistoryOptions = {
  query: string;
  projectId: string;
  state: string;
  source: string;
  range: string;
  page: number;
  pageSize: number;
};
export const defaultHistoryOptions: HistoryOptions = {
  query: "",
  projectId: "all",
  state: "all",
  source: "all",
  range: "all",
  page: 1,
  pageSize: 25,
};
export function RunHistory({
  options,
  onChange,
  onOpen,
  paused,
}: {
  options: HistoryOptions;
  onChange: (v: HistoryOptions) => void;
  onOpen: (r: Run) => void;
  paused: boolean;
}) {
  const [projects, setProjects] = useState<HistoryPage["projects"]>([]);
  const [data, setData] = useState<HistoryPage | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [debounced, setDebounced] = useState(options.query),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(options.query), 250);
    return () => clearTimeout(timer);
  }, [options.query]);
  useEffect(() => {
    if (paused) {
      setLoading(false);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    setLoading(true);
    setError("");
    setData(null);
    // Fix the date boundary for this filter session rather than moving it on each poll.
    const days = ({ "24h": 1, "7d": 7, "30d": 30 } as Record<string, number>)[
      options.range
    ];
    const since = days
      ? new Date(Date.now() - days * 86400000).toISOString()
      : undefined;
    async function load() {
      try {
        const result = await api("get_run_history", {
          page: options.page,
          pageSize: options.pageSize,
          query: debounced || undefined,
          projectId:
            options.projectId === "all" ? undefined : options.projectId,
          state: options.state === "all" ? undefined : options.state,
          source: options.source === "all" ? undefined : options.source,
          since,
        });
        if (!alive) return;
        setData(result);
        setProjects(result.projects);
        setError("");
        if (result.page !== options.page)
          onChange({ ...options, page: result.page });
      } catch (e) {
        if (alive) setError(fail(e));
      } finally {
        if (alive) {
          setLoading(false);
          timer = setTimeout(() => void load(), 2000);
        }
      }
    }
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [
    options.page,
    options.pageSize,
    options.projectId,
    options.state,
    options.source,
    options.range,
    debounced,
    retry,
    paused,
    onChange,
  ]);
  const pending = loading || debounced !== options.query;
  const filtered =
    !!options.query ||
    [options.projectId, options.state, options.source, options.range].some(
      (v) => v !== "all",
    );
  function filter(patch: Partial<HistoryOptions>) {
    onChange({ ...options, ...patch, page: 1 });
  }
  const currentPage = data?.page || options.page;
  const totalPages = data?.totalPages || 1;
  function page(value: number) {
    onChange({ ...options, page: value });
  }
  return (
    <div className="history-page">
      <header className="page-heading">
        <h1>Run history</h1>
        <p>Every pipeline, whether started by you or an agent.</p>
      </header>
      <div className="history-filters">
        <div className="history-search search-input">
          <Search className="size-4" />
          <Input
            aria-label="Search run history"
            placeholder="Search workflows, projects, jobs, or run IDs…"
            value={options.query}
            maxLength={200}
            onChange={(e) => filter({ query: e.target.value })}
            disabled={paused}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange({ ...defaultHistoryOptions, pageSize: options.pageSize })
          }
          disabled={!filtered || paused}
        >
          <X className="size-3.5" />
          Clear filters
        </Button>
        <div className="history-filter-grid">
          <Choice
            id="history-project"
            label="Project"
            value={options.projectId}
            onChange={(projectId) => filter({ projectId })}
            options={[
              { value: "all", label: "All projects" },
              ...projects.map((p) => ({
                value: p.id,
                label: p.name + (p.available ? "" : " (removed)"),
              })),
              ...(options.projectId !== "all" &&
              !projects.some((p) => p.id === options.projectId)
                ? [{ value: options.projectId, label: "Selected project" }]
                : []),
            ]}
          />
          <Choice
            id="history-state"
            label="Status"
            value={options.state}
            onChange={(state) => filter({ state })}
            options={[
              { value: "all", label: "All statuses" },
              ...runStates.map((v) => ({
                value: v,
                label: v[0].toUpperCase() + v.slice(1),
              })),
            ]}
          />
          <Choice
            id="history-source"
            label="Started by"
            value={options.source}
            onChange={(source) => filter({ source })}
            options={[
              { value: "all", label: "Anyone" },
              { value: "desktop", label: "Desktop" },
              { value: "cli", label: "CLI" },
              { value: "mcp", label: "AI agent (MCP)" },
            ]}
          />
          <Choice
            id="history-time"
            label="Created"
            value={options.range}
            onChange={(range) => filter({ range })}
            options={[
              { value: "all", label: "Any time" },
              { value: "24h", label: "Last 24 hours" },
              { value: "7d", label: "Last 7 days" },
              { value: "30d", label: "Last 30 days" },
            ]}
          />
        </div>
      </div>
      <div className="history-results-label" role="status" aria-live="polite">
        <span>
          <ListFilter className="size-3.5" />
          {paused
            ? "Runner stopped"
            : pending
              ? "Loading runs…"
              : data
                ? `${data.total.toLocaleString()} ${data.total === 1 ? "run" : "runs"}${filtered ? (data.total === 1 ? " matches your filters" : " match your filters") : ""}`
                : "Run history"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRetry((v) => v + 1)}
          disabled={pending || paused}
          aria-label="Refresh run history"
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      {paused ? (
        <Empty
          title="Runner stopped"
          description="Reconnect to the runner to browse run history."
          icon={<History />}
        />
      ) : error ? (
        <Empty
          title="Couldn’t load run history"
          description={error}
          action={
            <Button variant="outline" onClick={() => setRetry((v) => v + 1)}>
              Retry
            </Button>
          }
        />
      ) : loading ? (
        <div
          className="history-scroll space-y-3 p-3"
          aria-label="Loading run history"
        >
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : data?.runs.length ? (
        <ScrollArea
          className="history-scroll"
          viewportLabel="Run history results"
        >
          <Table aria-busy={pending}>
            <TableHeader>
              <TableRow>
                <TableHead>Workflow</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Started by</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Button
                      variant="link"
                      className="h-auto p-0"
                      onClick={() => onOpen(r)}
                      disabled={pending}
                    >
                      {r.request.workflowPath.split("/").pop()}
                    </Button>
                    <span className="history-event">
                      {r.request.event} · {r.request.jobId || "All jobs"}
                    </span>
                  </TableCell>
                  <TableCell>{r.projectName}</TableCell>
                  <TableCell>
                    <Status state={r.state} />{r.queueReason&&<p className="field-help">{r.queueReason.replaceAll("-"," ")}</p>}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {duration(r.startedAt, r.finishedAt)}
                  </TableCell>
                  <TableCell>
                    {r.source === "mcp"
                      ? "AI agent"
                      : r.source === "cli"
                        ? "CLI"
                        : "Desktop"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      ) : (
        <div className="history-scroll">
          <Empty
            title={data?.unfilteredTotal ? "No matching runs" : "A clean slate"}
            description={
              data?.unfilteredTotal
                ? "Try another search or clear your filters to see more runs."
                : "Run a workflow from one of your projects. Results will be saved here."
            }
            icon={<History />}
            action={
              filtered ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    onChange({
                      ...defaultHistoryOptions,
                      pageSize: options.pageSize,
                    })
                  }
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        </div>
      )}
      <div className="history-pagination">
        <p aria-live="polite">
          {data && !pending
            ? data.total
              ? `${((data.page - 1) * data.pageSize + 1).toLocaleString()}–${Math.min(data.page * data.pageSize, data.total).toLocaleString()} of ${data.total.toLocaleString()} ${data.total === 1 ? "run" : "runs"}`
              : "0 runs"
            : "—"}
        </p>
        <div className="history-page-size">
          <Choice
            id="history-page-size"
            label="Rows per page"
            value={String(options.pageSize)}
            onChange={(value) => filter({ pageSize: Number(value) })}
            options={[10, 25, 50, 100].map((n) => ({
              value: String(n),
              label: String(n),
            }))}
          />
        </div>
        <nav aria-label="Run history pagination">
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="First page"
            disabled={pending || paused || currentPage <= 1}
            onClick={() => page(1)}
          >
            <ChevronsLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={pending || paused || currentPage <= 1}
            onClick={() => page(currentPage - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={pending || paused || currentPage >= totalPages}
            onClick={() => page(currentPage + 1)}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Last page"
            disabled={pending || paused || currentPage >= totalPages}
            onClick={() => page(totalPages)}
          >
            <ChevronsRight />
          </Button>
        </nav>
      </div>
      <p className="history-retention">
        Completed runs are retained for 30 days, up to 200 runs.
      </p>
    </div>
  );
}
