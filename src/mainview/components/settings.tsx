import { useState } from "react";
import {
  Cable,
  Copy,
  Check,
  CircleCheck,
  CircleX,
  RefreshCw,
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
import type { Settings, Health } from "../../shared/contracts";
import { api, chooseFile, isDesktop } from "@/lib/api";
import { Choice } from "./run-dialog";
import { fail } from "./common";
export function SettingsView({
  settings,
  health,
  onSaved,
  onHealth,
  onStopped,
}: {
  settings: Settings;
  health: Health | null;
  onSaved: (s: Settings) => void;
  onHealth: () => void;
  onStopped: () => void;
}) {
  const [draft, setDraft] = useState(settings),
    [busy, setBusy] = useState(false),
    [stop, setStop] = useState(false);
  async function save() {
    setBusy(true);
    try {
      onSaved(await api("update_settings", draft));
      toast.success("Settings saved");
    } catch (e) {
      toast.error(fail(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-content">
      <header className="page-heading">
        <h1>Settings</h1>
        <p>Make Act Dock fit your local workflow.</p>
      </header>
      <section className="settings-section">
        <h2>Appearance</h2>
        <Choice
          id="theme"
          label="Theme"
          value={draft.theme}
          onChange={(v) =>
            setDraft({ ...draft, theme: v as Settings["theme"] })
          }
          options={[
            { value: "system", label: "Follow system" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </section>
      <Separator />
      <section className="settings-section">
        <h2>Background runner</h2>
        <div className="setting-row">
          <div>
            <Label htmlFor="login">Start at login</Label>
            <p>Keep the runner available after you sign in to your Mac.</p>
          </div>
          <Switch
            id="login"
            checked={draft.startAtLogin}
            onCheckedChange={(v) => setDraft({ ...draft, startAtLogin: v })}
          />
        </div>
        <p className="field-help">
          By default, opening Act Dock or calling its CLI/MCP tools starts the
          runner on demand. Closing the app leaves pipelines running.
        </p>
      </section>
      <Separator />
      <section className="settings-section">
        <div className="section-title">
          <h2>Dependencies</h2>
          <Button size="sm" variant="ghost" onClick={onHealth}>
            <RefreshCw className="size-3.5" />
            Check again
          </Button>
        </div>
        {(["act", "docker"] as const).map((name) => (
          <div className="field" key={name}>
            <Label htmlFor={name}>
              {name === "act" ? "act executable" : "Docker executable"}
            </Label>
            <div className="file-field">
              <Input
                id={name}
                className="mono"
                placeholder="Detect automatically"
                value={draft[name === "act" ? "actPath" : "dockerPath"]}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    [name === "act" ? "actPath" : "dockerPath"]: e.target.value,
                  })
                }
              />
              {isDesktop() && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    const path = await chooseFile();
                    if (path)
                      setDraft({
                        ...draft,
                        [name === "act" ? "actPath" : "dockerPath"]: path,
                      });
                  }}
                >
                  Browse
                </Button>
              )}
            </div>
            <p className="dependency-status">
              {health?.[name].ok ? (
                <CircleCheck className="size-3.5" />
              ) : (
                <CircleX className="size-3.5" />
              )}
              {health?.[name].message || "Checking…"}
            </p>
          </div>
        ))}
      </section>
      <div className="settings-actions">
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
        <Button variant="outline" onClick={() => setStop(true)}>
          Stop runner
        </Button>
      </div>
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
  const path =
    health?.executable || "~/Library/Application Support/Act Dock/bin/act-dock";
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
