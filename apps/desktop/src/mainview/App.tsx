import { APP_VERSION } from "../shared/version";
import brandMark from "../../assets/brand/pipeline-loop.png";
import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { toast } from "sonner";
import {
  Workflow as WorkflowIcon,
  Plus,
  Folder,
  FolderOpen,
  History,
  Cable,
  Settings as SettingsIcon,
  Search,
  RefreshCw,
  Play,
  GitBranch,
  ChevronRight,
  ArrowUpRight,
  CircleCheck,
  CircleX,
  LoaderCircle,
  Trash2,
  Terminal,
  Activity,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  SidebarInset,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
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
import { subscribeEvents } from "@/lib/events";
import { ProjectExecution } from "@/components/project-execution";
import { api, openExternal } from "@/lib/api";
import { AddProjectDialog } from "@/components/add-project-dialog";
import {
  RunHistory,
  defaultHistoryOptions,
  type HistoryOptions,
} from "@/components/run-history";
import { RunDialog } from "@/components/run-dialog";
import { RunDetail } from "@/components/run-detail";
import { SettingsView, AgentsView } from "@/components/settings";
import { Empty, IconButton, RunningBorder, fail } from "@/components/common";
import {
  HealthBanner,
  HealthStatusText,
  HealthView,
  healthIssueCount,
  type HealthActionHandler,
} from "@/components/health";
import {
  activeStates,
  settingsSchema,
  type Health,
  type HealthReport,
  type Project,
  type Run,
  type Settings,
  type Workflow,
} from "../shared/contracts";
type View = "project" | "history" | "agents" | "settings" | "health";
function Workspace() {
  const [projects, setProjects] = useState<Project[]>([]),
    [runs, setRuns] = useState<Run[]>([]),
    [discoveredWorkflows, setWorkflows] = useState<Workflow[]>([]);
  const [selected, setSelected] = useState<string | null>(null),
    [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null),
    [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [settings, setSettings] = useState<Settings>(settingsSchema.parse({})),
    [health, setHealth] = useState<Health | null>(null),
    [view, setView] = useState<View>("project");
  const [workflowError, setWorkflowError] = useState("");
  const { isMobile, setOpenMobile } = useSidebar();
  function closeNavigation() {
    if (isMobile) setOpenMobile(false);
  }
  const [loading, setLoading] = useState(true),
    [workflowLoading, setWorkflowLoading] = useState(false),
    [error, setError] = useState(""),
    [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false),
    [runWorkflow, setRunWorkflow] = useState<Workflow | null>(null),
    [remove, setRemove] = useState<Project | null>(null),
    [runnerStopped, setRunnerStopped] = useState(false),
    [mobileRun, setMobileRun] = useState(false);
  const { setTheme } = useTheme();
  const selectionVersion = useRef(0);
  const firstLoad = useRef(true);
  const [historyOptions, setHistoryOptions] = useState<HistoryOptions>(
    defaultHistoryOptions,
  );
  const workflows = discoveredWorkflows.filter((w) => w.projectId === selected);
  const project = projects.find((p) => p.id === selected) || null;
  const workflow =
    workflows.find((w) => w.path === selectedWorkflow) || workflows[0] || null;
  const refresh = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([
        api("list_projects"),
        api("get_runner_snapshot")
          .then((snapshot) => snapshot.runs)
          .catch(() => api("list_runs", { limit: 200 })),
      ]);
      setProjects(p);
      setRuns(r);
      setSelected((prev) =>
        prev && p.some((x) => x.id === prev) ? prev : p[0]?.id || null,
      );
      setSelectedRun((prev) =>
        prev ? r.find((x) => x.id === prev.id) || prev : null,
      );
      setError("");
      if (firstLoad.current) {
        firstLoad.current = false;
        const [s, h] = await Promise.all([api("get_settings"), api("health")]);
        setSettings(s);
        setTheme(s.theme);
        setHealth(h);
      }
    } catch (e) {
      setError(fail(e));
    } finally {
      setLoading(false);
    }
  }, [setTheme]);
  const refreshHealth = useCallback(() => {
    void api("health")
      .then(setHealth)
      .catch((e) => toast.error(fail(e)));
  }, []);
  const [report, setReport] = useState<HealthReport | null>(null),
    [checking, setChecking] = useState(false),
    [fixing, setFixing] = useState<string | null>(null);
  const checkHealth = useCallback(async () => {
    setChecking(true);
    try {
      setReport(await api("check_health"));
    } catch {
      // The connection banner already explains an unreachable runner.
    } finally {
      setChecking(false);
    }
  }, []);
  const pendingFix = report?.checks.some((c) => c.status === "pending");
  useEffect(() => {
    if (runnerStopped) return;
    void checkHealth();
    // Poll quickly while a fix is in progress or the page is open, and gently otherwise.
    const id = setInterval(
      () => void checkHealth(),
      pendingFix ? 2500 : view === "health" ? 6000 : 20000,
    );
    window.addEventListener("focus", checkHealth);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", checkHealth);
    };
  }, [checkHealth, runnerStopped, pendingFix, view]);
  const onHealthAction: HealthActionHandler = (check) => {
    const action = check.action;
    if (!action) return;
    if (action.kind === "view") {
      setView(action.target);
      closeNavigation();
    } else if (action.kind === "link") {
      void openExternal(action.url);
    } else {
      setFixing(check.id);
      void api("fix_health", { action: action.id })
        .then((r) => toast.success(r.message))
        .catch((e) => toast.error(fail(e)))
        .finally(() => {
          setFixing(null);
          void checkHealth();
          refreshHealth();
        });
    }
  };
  const blocked = report?.overall === "blocked";
  const issueCount = healthIssueCount(report);
  useEffect(() => {
    if (runnerStopped) return;
    void refresh();
    const unsubscribe = subscribeEvents((events) => {
      if (!events.length || events.some((event) => event.kind === "settings")) {
        void api("get_settings")
          .then((next) => {
            setSettings((previous) =>
              JSON.stringify(previous) === JSON.stringify(next)
                ? previous
                : next,
            );
            setTheme(next.theme);
          })
          .catch(() => {});
      }
      if (
        !events.length ||
        events.some((e) =>
          ["run", "queue", "projects", "settings"].includes(e.kind),
        )
      )
        void refresh();
    });
    const focus = () => {
      void refresh();
      refreshHealth();
    };
    window.addEventListener("focus", focus);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", focus);
    };
  }, [refresh, refreshHealth, runnerStopped, setTheme]);
  const refreshWorkflows = useCallback(async () => {
    if (runnerStopped) return;
    const version = ++selectionVersion.current;
    if (!selected) {
      setWorkflows([]);
      return;
    }
    setWorkflowLoading(true);
    setWorkflowError("");
    try {
      const w = await api("list_workflows", { projectId: selected });
      if (version === selectionVersion.current) {
        setWorkflows(w);
        setSelectedWorkflow((prev) =>
          w.some((x) => x.path === prev) ? prev : w[0]?.path || null,
        );
      }
    } catch (e) {
      if (version === selectionVersion.current) {
        setWorkflows([]);
        setWorkflowError(fail(e));
      }
    } finally {
      if (version === selectionVersion.current) setWorkflowLoading(false);
    }
  }, [selected, runnerStopped]);
  useEffect(() => {
    void refreshWorkflows();
    const focus = () => void refreshWorkflows();
    window.addEventListener("focus", focus);
    return () => {
      selectionVersion.current++;
      window.removeEventListener("focus", focus);
    };
  }, [refreshWorkflows]);
  function openAdd() {
    closeNavigation();
    setAddOpen(true);
  }
  function addedProject(p: Project) {
    setSelected(p.id);
    setView("project");
    setSelectedRun(null);
    setMobileRun(false);
    void refresh();
    toast.success(p.name + " added");
  }
  function selectProject(p: Project) {
    closeNavigation();
    if (p.id !== selected) {
      setWorkflows([]);
      setSelectedWorkflow(null);
      setWorkflowError("");
    } else {
      void refreshWorkflows();
    }
    setSelected(p.id);
    setView("project");
    setSelectedRun(null);
    setMobileRun(false);
    setSearch("");
  }
  function showRun(r: Run) {
    closeNavigation();
    setSelectedRun(r);
    setMobileRun(true);
    if (!runnerStopped) void refresh();
  }
  const active = runs.filter((r) => activeStates.includes(r.state));
  const running = runs.filter((r) => r.state === "running");
  const queued = runs.filter((r) => r.state === "queued");
  const cancelling = runs.filter((r) => r.state === "cancelling");
  return (
    <>
      <Sidebar>
        <SidebarHeader className="brand-header">
          <div className="brand-mark">
            <img src={brandMark} alt="" className="brand-symbol" />
          </div>
          <div>
            <strong>Act Dock</strong>
            <span>Local pipeline runner</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <div className="sidebar-section-heading">
              <SidebarGroupLabel>Projects</SidebarGroupLabel>
              <IconButton label="Add project" onClick={() => void openAdd()}>
                <Plus className="size-4" />
              </IconButton>
            </div>
            <SidebarGroupContent>
              <SidebarMenu>
                {loading ? (
                  <div className="px-2 space-y-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : (
                  projects.map((p) => (
                    <SidebarMenuItem key={p.id}>
                      <SidebarMenuButton
                        isActive={view === "project" && p.id === selected}
                        onClick={() => selectProject(p)}
                        tooltip={p.path}
                      >
                        <Folder className="size-4" />
                        <span>{p.name}</span>
                        {runs.some(
                          (r) =>
                            r.request.projectId === p.id &&
                            r.state === "running",
                        ) && (
                          <LoaderCircle
                            className="ml-auto size-3 animate-spin running-foreground"
                            aria-label="Running pipeline"
                          />
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))
                )}
                {!loading && !projects.length && (
                  <p className="sidebar-empty">
                    Add a project to discover its workflows.
                  </p>
                )}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => void openAdd()}
                    className="text-muted-foreground"
                  >
                    <Plus className="size-4" />
                    <span>Add project</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarMenu>
              {(
                [
                  { id: "history", label: "Run history", icon: History },
                  { id: "agents", label: "Agent connections", icon: Cable },
                  { id: "health", label: "System health", icon: Activity },
                ] as const
              ).map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={view === item.id}
                    onClick={() => {
                      setView(item.id);
                      closeNavigation();
                    }}
                  >
                    <item.icon className="size-4" />
                    <span>{item.label}</span>
                    {item.id === "history" && active.length > 0 && (
                      <Badge
                        variant="secondary"
                        className={`ml-auto text-[11px] ${running.length ? "running-count" : ""}`}
                        aria-label={
                          running.length
                            ? `${running.length} running`
                            : `${active.length} queued or cancelling`
                        }
                      >
                        {running.length || active.length}
                      </Badge>
                    )}
                    {item.id === "health" && issueCount > 0 && (
                      <span
                        className="ml-auto health-nav-badge"
                        data-blocked={blocked || undefined}
                        aria-label={
                          blocked
                            ? "Pipelines are blocked"
                            : `${issueCount} suggestions`
                        }
                      >
                        {blocked ? "!" : issueCount}
                      </span>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
          {runs.length > 0 && (
            <SidebarGroup className="recent-group">
              <SidebarGroupLabel>Recent runs</SidebarGroupLabel>
              <SidebarMenu>
                {runs.slice(0, 4).map((r) => (
                  <SidebarMenuItem key={r.id}>
                    <SidebarMenuButton
                      className="recent-run"
                      data-run-state={r.state}
                      onClick={() => {
                        setSelected(r.request.projectId);
                        setView("project");
                        showRun(r);
                      }}
                    >
                      <span className="recent-run-icon">
                        {r.state === "succeeded" ? (
                          <CircleCheck />
                        ) : r.state === "running" ? (
                          <LoaderCircle className="animate-spin" />
                        ) : r.state === "failed" ? (
                          <CircleX />
                        ) : (
                          <History />
                        )}
                      </span>
                      <span>
                        <span className="recent-name">
                          {r.request.workflowPath.split("/").pop()}
                        </span>
                        <span className="recent-project">
                          {r.projectName} · {r.state}
                        </span>
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          )}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={view === "settings"}
                onClick={() => {
                  setView("settings");
                  closeNavigation();
                }}
              >
                <SettingsIcon className="size-4" />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <Separator />
          <div className="runner-indicator">
            <span className="runner-dot" />
            <span>
              {runnerStopped
                ? "Runner stopped"
                : error
                  ? "Runner unavailable"
                  : "Local runner"}
            </span>
            <span className="ml-auto">v{APP_VERSION}</span>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <span>Workspace</span>
            <ChevronRight className="size-3" />
            <strong>
              {view === "project"
                ? project?.name || "Projects"
                : view === "history"
                  ? "Run history"
                  : view === "agents"
                    ? "Agent connections"
                    : view === "health"
                      ? "System health"
                      : "Settings"}
            </strong>
          </div>
          <div className="topbar-meta">
            <Terminal className="size-3.5" />
            <span>Runs on your machine</span>
          </div>
        </header>
        {(error || runnerStopped) && (
          <div className="connection-banner" role="alert">
            <CircleX className="size-4" />
            <span>
              {runnerStopped ? "Runner stopped. Start it to continue." : error}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setRunnerStopped(false);
                firstLoad.current = true;
                void refresh();
              }}
            >
              Reconnect
            </Button>
          </div>
        )}
        {!error && !runnerStopped && view !== "health" && (
          <HealthBanner
            report={report}
            busy={fixing}
            onAction={onHealthAction}
            onOpen={() => setView("health")}
          />
        )}
        {view === "project" && (
          <div className={`workspace ${mobileRun ? "show-run" : ""}`}>
            <section className="workflow-pane">
              {project && (
                <ProjectExecution
                  key={project.id}
                  project={project}
                  onSaved={(p) =>
                    setProjects((previous) =>
                      previous.map((item) => (item.id === p.id ? p : item)),
                    )
                  }
                />
              )}
              <div className="project-heading">
                <div>
                  <h1>{project?.name || "Your projects"}</h1>
                  <p className="mono" title={project?.path}>
                    {project?.path || "GitHub Actions, on your machine."}
                  </p>
                </div>
                <div className="flex items-center">
                  <IconButton
                    label="Refresh workflows"
                    onClick={() => void refreshWorkflows()}
                    disabled={workflowLoading || !project}
                  >
                    <RefreshCw
                      className={`size-4 ${workflowLoading ? "animate-spin" : ""}`}
                    />
                  </IconButton>
                  {project && (
                    <IconButton
                      label="Remove project"
                      onClick={() => setRemove(project)}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  )}
                </div>
              </div>
              {project && (
                <div className="workflow-search">
                  <div className="search-input">
                    <Search className="size-4" />
                    <Input
                      aria-label="Search workflows"
                      placeholder="Find a workflow…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <span>{workflows.length}</span>
                </div>
              )}
              <ScrollArea className="workflow-scroll">
                {loading || workflowLoading ? (
                  <div className="p-5 space-y-3">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : !project ? (
                  <Empty
                    title="Bring your CI home"
                    description="Choose a local project with GitHub Actions workflows. Run, inspect, and iterate without leaving your machine."
                    icon={<FolderOpen className="size-7" />}
                    action={
                      <Button onClick={() => void openAdd()}>
                        <Plus className="size-4" />
                        Add your first project
                      </Button>
                    }
                  />
                ) : workflowError ? (
                  <Empty
                    title="Couldn’t read workflows"
                    description={workflowError}
                    icon={<CircleX />}
                    action={
                      <Button
                        variant="outline"
                        onClick={() => void refreshWorkflows()}
                      >
                        <RefreshCw className="size-4" />
                        Retry discovery
                      </Button>
                    }
                  />
                ) : !workflows.length ? (
                  <Empty
                    title="No workflows yet"
                    description="Add a .yml or .yaml workflow to this project’s .github/workflows folder, then refresh."
                    icon={<WorkflowIcon />}
                    action={
                      <Button
                        variant="outline"
                        onClick={() => void refreshWorkflows()}
                      >
                        <RefreshCw className="size-4" />
                        Refresh workflows
                      </Button>
                    }
                  />
                ) : (
                  <>
                    <div className="workflow-list">
                      {workflows
                        .filter((w) =>
                          (w.name + " " + w.path)
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                        )
                        .map((w) => {
                          const isRunning = running.some(
                            (r) =>
                              r.request.projectId === w.projectId &&
                              r.request.workflowPath === w.path,
                          );
                          return (
                            <Button
                              key={w.path}
                              variant="ghost"
                              className={`workflow-item ${workflow?.path === w.path ? "selected" : ""} ${isRunning ? "is-running" : ""}`}
                              onClick={() => setSelectedWorkflow(w.path)}
                            >
                              {isRunning && <RunningBorder />}
                              <WorkflowIcon className="size-4 shrink-0" />
                              <span className="min-w-0 flex-1">
                                <span className="workflow-name">{w.name}</span>
                                <span className="workflow-file mono">
                                  {w.path.split("/").pop()}
                                </span>
                                <span className="workflow-tags">
                                  {w.diagnostic ? (
                                    <Badge variant="outline">
                                      <CircleX className="size-3" />
                                      Invalid workflow
                                    </Badge>
                                  ) : (
                                    <>
                                      {w.events.slice(0, 2).map((e) => (
                                        <Badge key={e} variant="secondary">
                                          {e}
                                        </Badge>
                                      ))}
                                      {isRunning && (
                                        <Badge
                                          variant="outline"
                                          data-run-state="running"
                                        >
                                          <LoaderCircle className="size-3 animate-spin" />
                                          Running
                                        </Badge>
                                      )}
                                      <span>
                                        {w.jobs.length}{" "}
                                        {w.jobs.length === 1 ? "job" : "jobs"}
                                      </span>
                                    </>
                                  )}
                                </span>
                              </span>
                              <ChevronRight className="size-3.5 text-muted-foreground" />
                            </Button>
                          );
                        })}
                    </div>
                    {!workflows.some((w) =>
                      (w.name + " " + w.path)
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    ) && (
                      <p className="search-empty">
                        No workflows match “{search}”.
                      </p>
                    )}
                    {workflow && (
                      <div className="workflow-details">
                        <div className="section-title">
                          <h2>Workflow details</h2>
                          <GitBranch className="size-4 text-muted-foreground" />
                        </div>
                        {workflow.diagnostic ? (
                          <p className="form-error" role="alert">
                            {workflow.diagnostic}
                          </p>
                        ) : (
                          <>
                            <div className="jobs-list">
                              {workflow.jobs.map((j) => (
                                <div className="job-row" key={j.id}>
                                  <span className="job-node" />
                                  <div>
                                    <h3>{j.name}</h3>
                                    <p className="mono">
                                      {j.runners.join(", ") ||
                                        "Reusable workflow"}
                                    </p>
                                    {j.needs.length > 0 && (
                                      <p>Needs: {j.needs.join(", ")}</p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                            {workflow.inputs.length > 0 && (
                              <p className="field-help">
                                {workflow.inputs.length} manual{" "}
                                {workflow.inputs.length === 1
                                  ? "input"
                                  : "inputs"}{" "}
                                available when running.
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </ScrollArea>
              {project && workflow && (
                <div className="workflow-action">
                  {blocked ? (
                    <button
                      type="button"
                      className="workflow-blocked"
                      onClick={() => setView("health")}
                    >
                      <span>
                        Setup needs attention. Preview this run for details.
                      </span>
                      <span>Fix it</span>
                    </button>
                  ) : (
                    <div>
                      <span>
                        {workflow.jobs.length}{" "}
                        {workflow.jobs.length === 1 ? "job" : "jobs"}
                      </span>
                      <span>Current working files</span>
                    </div>
                  )}
                  <Button
                    className="w-full"
                    disabled={
                      !!workflow.diagnostic ||
                      runnerStopped ||
                      workflowLoading ||
                      !!workflowError
                    }
                    onClick={() => setRunWorkflow(workflow)}
                  >
                    <Play className="size-4" />
                    Run workflow
                  </Button>
                </div>
              )}
              {project &&
                runs.some((r) => r.request.projectId === project.id) && (
                  <Button
                    variant="ghost"
                    className="narrow-view-run"
                    onClick={() => {
                      const r = runs.find(
                        (r) => r.request.projectId === project.id,
                      );
                      if (r) showRun(r);
                    }}
                  >
                    View latest run
                    <ArrowUpRight className="size-4" />
                  </Button>
                )}
            </section>
            <RunDetail
              run={runnerStopped ? null : selectedRun}
              onRun={showRun}
              onBack={() => setMobileRun(false)}
            />
          </div>
        )}
        {view === "history" && (
          <RunHistory
            options={historyOptions}
            onChange={setHistoryOptions}
            paused={runnerStopped}
            onOpen={(r) => {
              setSelected(r.request.projectId);
              setView("project");
              showRun(r);
            }}
          />
        )}
        {view === "agents" && (
          <ScrollArea className="page-scroll">
            <AgentsView health={health} />
          </ScrollArea>
        )}
        {view === "health" && (
          <ScrollArea className="page-scroll">
            <HealthView
              report={report}
              checking={checking}
              busy={fixing}
              onCheck={() => void checkHealth()}
              onAction={onHealthAction}
            />
          </ScrollArea>
        )}
        {view === "settings" && (
          <ScrollArea className="page-scroll">
            <SettingsView
              settings={settings}
              health={health}
              onSaved={(s) => {
                setSettings(s);
                setTheme(s.theme);
                refreshHealth();
              }}
              onHealth={refreshHealth}
              onStopped={() => {
                setRunnerStopped(true);
                toast.success("Runner stopped");
              }}
            />
          </ScrollArea>
        )}
        <footer className="statusbar">
          <span>
            <GitBranch className="size-3" />
            GitHub Actions via act
          </span>
          <span>
            <span className={running.length ? "running-foreground" : undefined}>
              {running.length
                ? `${running.length} running`
                : !active.length
                  ? "No active runs"
                  : null}
            </span>
            {queued.length > 0 && (
              <span>
                {running.length ? " · " : ""}
                {queued.length} queued
              </span>
            )}
            {cancelling.length > 0 && (
              <span>
                {running.length || queued.length ? " · " : ""}
                {cancelling.length} cancelling
              </span>
            )}
            <span className="status-separator">·</span>
            <button
              type="button"
              className="statusbar-health"
              data-blocked={blocked || undefined}
              onClick={() => setView("health")}
            >
              <HealthStatusText report={report} />
            </button>
          </span>
        </footer>
      </SidebarInset>
      {addOpen && (
        <AddProjectDialog
          initialPath={project?.path}
          onClose={() => setAddOpen(false)}
          onAdded={addedProject}
        />
      )}
      {project && runWorkflow && (
        <RunDialog
          key={runWorkflow.path}
          project={project}
          workflow={runWorkflow}
          onClose={() => setRunWorkflow(null)}
          onRun={(r) => {
            showRun(r);
            toast.success("Workflow queued");
          }}
        />
      )}
      <AlertDialog
        open={!!remove}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {remove?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the project from Act Dock. Project files and saved
              run history are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep project</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (remove)
                  void api("remove_project", { projectId: remove.id })
                    .then(() => {
                      setRemove(null);
                      void refresh();
                    })
                    .catch((e) => toast.error(fail(e)));
              }}
            >
              Remove project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Toaster position="bottom-right" />
    </>
  );
}
export default function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider delayDuration={300}>
        <SidebarProvider
          style={{ "--sidebar-width": "232px" } as React.CSSProperties}
        >
          <Workspace />
        </SidebarProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
