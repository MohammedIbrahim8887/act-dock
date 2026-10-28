import { useEffect, useState } from "react";
import {
  Boxes,
  Cable,
  Copy,
  Check,
  CircleCheck,
  CircleX,
  Gauge,
  HardDrive,
  Power,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  defaultExecution,
  type ExecutionOptions,
  type Settings,
  type Health,
} from "../../shared/contracts";
import { api, chooseFile, isDesktop } from "@/lib/api";
import {
  CachePolicyPanel,
  OptionCards,
  RunBehaviorPanel,
  RunnerImagesPanel,
  SettingBlock,
  invalidMappings,
  type Layers,
} from "./execution-editor";
import { fail } from "./common";
export type SettingsTab = "general" | "images" | "behavior" | "caches";
const settingsTabFields: Record<SettingsTab, (keyof ExecutionOptions)[]> = {
  general: [],
  images: ["runnerMappings", "imagePullPolicy"],
  behavior: ["workspaceMode", "concurrentJobs", "reservation"],
  caches: ["actionCachePolicy", "packageCaches"],
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function SettingsView({
  settings,
  health,
  tab,
  onTab,
  onSaved,
  onHealth,
  onStopped,
}: {
  settings: Settings;
  health: Health | null;
  tab: SettingsTab;
  onTab: (t: SettingsTab) => void;
  onSaved: (s: Settings) => void;
  onHealth: () => void;
  onStopped: () => void;
}) {
  const [draft, setDraft] = useState(settings),
    [busy, setBusy] = useState(false),
    [stop, setStop] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  async function save() {
    setBusy(true);
    try {
      onSaved(await api("patch_settings", draft));
      toast.success("Settings saved");
    } catch (e) {
      toast.error(fail(e));
    } finally {
      setBusy(false);
    }
  }
  const execution = draft.executionDefaults || {};
  const layers: Layers = {
    base: defaultExecution,
    overrides: execution,
    sourceOf: () => "Built-in default",
    scope: "global",
    onChange: (executionDefaults) => setDraft({ ...draft, executionDefaults }),
  };
  const dirty = !same(draft, settings),
    invalid = invalidMappings(execution);
  const generalDirty = !same(
    { ...draft, executionDefaults: undefined, cacheBudgets: undefined, concurrency: undefined },
    { ...settings, executionDefaults: undefined, cacheBudgets: undefined, concurrency: undefined },
  );
  const changed = (t: SettingsTab) =>
    t === "general"
      ? generalDirty
      : settingsTabFields[t].some(
          (k) => !same(execution[k], settings.executionDefaults?.[k]),
        ) ||
        (t === "caches" && !same(draft.cacheBudgets, settings.cacheBudgets)) ||
        (t === "behavior" && !same(draft.concurrency, settings.concurrency));
  const budgets = { projectGiB: 5, totalGiB: 20, ...draft.cacheBudgets };
  const tabs: [SettingsTab, string, typeof Boxes][] = [
    ["general", "General", SlidersHorizontal],
    ["images", "Runner images", Boxes],
    ["behavior", "Run behavior", Gauge],
    ["caches", "Caches", HardDrive],
  ];
  return (
    <div className="page-content settings-page">
      <header className="settings-heading">
        <h1>Settings</h1>
        <p>Defaults for every project. Each project can change them in its own settings.</p>
      </header>
      <Tabs value={tab} onValueChange={(v) => onTab(v as SettingsTab)}>
        <TabsList variant="line" className="settings-tabs">
          {tabs.map(([value, label, Icon]) => (
            <TabsTrigger key={value} value={value}>
              <Icon className="size-3.5" />
              {label}
              {changed(value) && (
                <span className="tab-dot" aria-label="Unsaved changes" />
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="general">
          <div className="tab-stack">
            <SettingBlock title="Appearance">
              <OptionCards
                name="theme"
                label="Theme"
                value={draft.theme}
                onChange={(theme) => setDraft({ ...draft, theme })}
                options={[
                  { value: "system", title: "Follow system", description: "Match your computer’s light or dark mode." },
                  { value: "light", title: "Light", description: "Always use the light theme." },
                  { value: "dark", title: "Dark", description: "Always use the dark theme." },
                ]}
              />
            </SettingBlock>
            <SettingBlock
              title="Background runner"
              description="Opening Act Dock or calling its CLI or MCP tools starts the runner on demand. Closing the app leaves pipelines running."
            >
              <ul className="toggle-list">
                <li>
                  <div>
                    <Label htmlFor="login">Start at login</Label>
                    <p>Keep the runner available after you sign in to your computer.</p>
                  </div>
                  <Switch
                    id="login"
                    checked={draft.startAtLogin}
                    onCheckedChange={(v) => setDraft({ ...draft, startAtLogin: v })}
                  />
                </li>
                <li>
                  <div>
                    <Label>Stop the runner</Label>
                    <p>Cancels queued and active runs. It starts again when needed.</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setStop(true)}>
                    <Power className="size-3.5" />
                    Stop runner
                  </Button>
                </li>
              </ul>
            </SettingBlock>
            <SettingBlock
              title="Dependencies"
              description="Leave these empty to use the bundled Act engine and detect Docker automatically."
              aside={
                <Button size="sm" variant="ghost" onClick={onHealth}>
                  <RefreshCw className="size-3.5" />
                  Check again
                </Button>
              }
            >
              <div className="dependency-list">
                {(["act", "docker"] as const).map((name) => {
                  const key = name === "act" ? "actPath" : "dockerPath";
                  return (
                    <div className="field" key={name}>
                      <Label htmlFor={name}>
                        {name === "act" ? "Act engine" : "Docker executable"}
                      </Label>
                      <div className="file-field">
                        <Input
                          id={name}
                          className="mono"
                          placeholder={
                            name === "act"
                              ? "Bundled Act engine"
                              : "Detect automatically"
                          }
                          value={draft[key]}
                          onChange={(e) =>
                            setDraft({ ...draft, [key]: e.target.value })
                          }
                        />
                        {isDesktop() && (
                          <Button
                            variant="outline"
                            onClick={async () => {
                              const path = await chooseFile();
                              if (path) setDraft({ ...draft, [key]: path });
                            }}
                          >
                            Browse…
                          </Button>
                        )}
                      </div>
                      <p
                        className="dependency-status"
                        data-ok={health?.[name].ok ? "" : undefined}
                      >
                        {health?.[name].ok ? (
                          <CircleCheck className="size-3.5" />
                        ) : (
                          <CircleX className="size-3.5" />
                        )}
                        {health?.[name].message || "Checking…"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </SettingBlock>
          </div>
        </TabsContent>
        <TabsContent value="images">
          <RunnerImagesPanel layers={layers} />
        </TabsContent>
        <TabsContent value="behavior">
          <RunBehaviorPanel layers={layers}>
            <SettingBlock
              title="Workflows at the same time"
              description="Run independent workflows side by side. Runs that share a workspace, container names or a writable cache still wait their turn."
            >
              <div className="inline-control">
                <Switch
                  id="workflow-concurrency"
                  checked={draft.concurrency?.enabled || false}
                  onCheckedChange={(enabled) =>
                    setDraft({
                      ...draft,
                      concurrency: {
                        enabled,
                        maxWorkflows: draft.concurrency?.maxWorkflows || 2,
                      },
                    })
                  }
                />
                <Label htmlFor="workflow-concurrency">
                  Run independent workflows concurrently
                </Label>
                {draft.concurrency?.enabled && (
                  <div className="stepper">
                    <Input
                      type="number"
                      min={1}
                      max={8}
                      aria-label="Maximum active workflows"
                      value={draft.concurrency.maxWorkflows}
                      onChange={(e) => {
                        const n = Math.round(Number(e.target.value));
                        if (n >= 1 && n <= 8)
                          setDraft({
                            ...draft,
                            concurrency: { enabled: true, maxWorkflows: n },
                          });
                      }}
                    />
                    <span>at most</span>
                  </div>
                )}
              </div>
              <p className="block-note">
                Admission also stays within 75% of Docker’s CPU and memory.
              </p>
            </SettingBlock>
          </RunBehaviorPanel>
        </TabsContent>
        <TabsContent value="caches">
          <CachePolicyPanel layers={layers}>
            <SettingBlock
              title="Storage budgets"
              description="When a budget is exceeded, idle caches are removed oldest first. Caches whose size isn’t measured yet don’t count."
            >
              <div className="reservation-grid">
                {(["projectGiB", "totalGiB"] as const).map((key) => (
                  <div className="field" key={key}>
                    <Label htmlFor={`cache-budget-${key}`}>
                      {key === "projectGiB" ? "Per project" : "All projects"}
                    </Label>
                    <div className="stepper">
                      <Input
                        id={`cache-budget-${key}`}
                        type="number"
                        min={0.25}
                        step={0.25}
                        value={budgets[key]}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (n > 0)
                            setDraft({
                              ...draft,
                              cacheBudgets: { ...budgets, [key]: n },
                            });
                        }}
                      />
                      <span>GiB</span>
                    </div>
                  </div>
                ))}
              </div>
            </SettingBlock>
          </CachePolicyPanel>
        </TabsContent>
      </Tabs>
      {dirty && (
        <div className="save-bar" role="region" aria-label="Unsaved changes">
          <span>
            {invalid.length
              ? `Fix the image for ${invalid.join(", ")} to save.`
              : "You have unsaved changes."}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setDraft(settings)}>
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
      <AlertDialog open={stop} onOpenChange={setStop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop the background runner?</AlertDialogTitle>
            <AlertDialogDescription>
              Queued and active runs will be cancelled. Opening Act Dock again
              or using an agent tool starts the runner again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void api("stop")
                  .then(onStopped)
                  .catch((e) => toast.error(fail(e)));
              }}
            >
              Stop runner
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
export function AgentsView({ health }: { health: Health | null }) {
  const [copied, setCopied] = useState(false);
  const path = health?.executable || "act-dock";
  const config = JSON.stringify(
    { mcpServers: { "act-dock": { command: path, args: ["mcp"] } } },
    null,
    2,
  );
  return (
    <div className="page-content">
      <header className="page-heading">
        <div className="page-icon">
          <Cable />
        </div>
        <h1>Connect your agents</h1>
        <p>Give local AI agents the same pipeline runner you use here.</p>
      </header>
      <section className="settings-section">
        <h2>MCP connection</h2>
        <p>
          Add this stdio server to your agent’s MCP configuration, then restart
          or reconnect the agent.
        </p>
        <Textarea
          aria-label="MCP server configuration"
          className="mono mcp-config"
          readOnly
          value={config}
        />
        <Button
          variant="outline"
          onClick={() =>
            void navigator.clipboard
              .writeText(config)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              })
              .catch(() =>
                toast.error("Select the configuration and copy it manually."),
              )
          }
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy configuration"}
        </Button>
        <p className="field-help">
          The packaged app installs this executable at a stable path. Agents
          start the runner on demand, even with the desktop app closed.
        </p>
      </section>
      <Separator />
      <section className="settings-section">
        <h2>Available tools</h2>
        <div className="tool-list">
          {[
            ["list_projects", "Find saved projects"],
            ["add_project", "Register any local folder"],
            ["list_workflows", "Discover workflows, jobs, and inputs"],
            ["run_pipeline", "Queue a workflow or job"],
            ["list_runs", "Browse recent runs"],
            ["get_run", "Check status and exit code"],
            ["get_run_logs", "Read output with a resumable cursor"],
            ["cancel_run", "Cancel queued or active work"],
            ["check_health", "Check Docker, act, and setup before running"],
          ].map(([name, desc]) => (
            <div key={name}>
              <code>{name}</code>
              <span>{desc}</span>
            </div>
          ))}
        </div>
      </section>
      <Separator />
      <section className="settings-section">
        <h2>Try asking your agent</h2>
        <blockquote>
          “Add my project, find its CI workflow, run the tests, and show me any
          failing output.”
        </blockquote>
        <p className="field-help">
          Agents can register local folders and execute their workflows without
          per-run prompts. Workflow execution has your user permissions.
        </p>
      </section>
    </div>
  );
}
