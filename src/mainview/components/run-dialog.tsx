import { useState } from "react";
import { Play, File, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import type {
  Project,
  Run,
  RunRequest,
  Workflow,
} from "../../shared/contracts";
import { api, chooseFile, isDesktop } from "@/lib/api";
import { fail } from "./common";
export function Choice({
  label,
  value,
  onChange,
  options,
  id,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  id: string;
}) {
  return (
    <div className="field">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
export function RunDialog({
  workflow: w,
  project: p,
  onClose,
  onRun,
}: {
  workflow: Workflow;
  project: Project;
  onClose: () => void;
  onRun: (r: Run) => void;
}) {
  const event =
    ["workflow_dispatch", "push"].find((e) => w.events.includes(e)) ||
    w.events[0] ||
    "push";
  const [request, setRequest] = useState<RunRequest>({
    projectId: p.id,
    workflowPath: w.path,
    event:
      p.defaults.event && w.events.includes(p.defaults.event)
        ? p.defaults.event
        : event,
    inputs: Object.fromEntries(
      w.inputs
        .filter((i) => i.default !== undefined || i.type === "boolean")
        .map((i) => [i.name, i.default ?? "false"]),
    ),
    architecture: p.defaults.architecture || "auto",
    ...Object.fromEntries(
      ["eventFile", "envFile", "varFile", "secretFile"]
        .filter((k) => p.defaults[k as keyof RunRequest])
        .map((k) => [k, p.defaults[k as keyof RunRequest]]),
    ),
  });
  const [save, setSave] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const update = (key: keyof RunRequest, value: unknown) =>
    setRequest((r) => ({ ...r, [key]: value }));
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const r = await api("run_pipeline", request);
      if (save)
        await api("save_defaults", {
          projectId: p.id,
          defaults: {
            event: request.event,
            architecture: request.architecture,
            eventFile: request.eventFile,
            envFile: request.envFile,
            varFile: request.varFile,
            secretFile: request.secretFile,
          },
        }).catch((e) =>
          toast.error("Run queued; defaults could not be saved: " + fail(e)),
        );
      onRun(r);
      onClose();
    } catch (e) {
      setError(fail(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="run-dialog">
        <DialogHeader>
          <DialogTitle>Run {w.name}</DialogTitle>
          <DialogDescription>
            Run this workflow against the current files in {p.name}.
          </DialogDescription>
        </DialogHeader>
        <div className="dialog-body">
          <div className="form-grid">
            <Choice
              id="run-event"
              label="Event"
              value={request.event}
              onChange={(v) => update("event", v)}
              options={w.events.map((e) => ({ value: e, label: e }))}
            />
            <Choice
              id="run-job"
              label="Jobs"
              value={request.jobId || "all"}
              onChange={(v) => update("jobId", v === "all" ? undefined : v)}
              options={[
                { value: "all", label: "All jobs" },
                ...w.jobs.map((j) => ({ value: j.id, label: j.name })),
              ]}
            />
          </div>
          {request.event === "workflow_dispatch" && w.inputs.length > 0 && (
            <>
              <Separator />
              <div className="field-stack">
                <h3>Workflow inputs</h3>
                {w.inputs.map((i) => (
                  <div className="field" key={i.name}>
                    {i.type === "boolean" ? (
                      <div className="check-row">
                        <Checkbox
                          id={"input-" + i.name}
                          checked={request.inputs[i.name] === "true"}
                          onCheckedChange={(v) =>
                            update("inputs", {
                              ...request.inputs,
                              [i.name]: String(v === true),
                            })
                          }
                        />
                        <Label htmlFor={"input-" + i.name}>
                          {i.name}
                          {i.required ? " *" : ""}
                        </Label>
                      </div>
                    ) : i.type === "choice" ? (
                      <Choice
                        id={"input-" + i.name}
                        label={i.name + (i.required ? " *" : "")}
                        value={request.inputs[i.name] || ""}
                        onChange={(v) =>
                          update("inputs", { ...request.inputs, [i.name]: v })
                        }
                        options={i.options.map((v) => ({ value: v, label: v }))}
                      />
                    ) : (
                      <>
                        <Label htmlFor={"input-" + i.name}>
                          {i.name}
                          {i.required ? " *" : ""}
                        </Label>
                        <Input
                          id={"input-" + i.name}
                          type={i.type === "number" ? "number" : "text"}
                          value={request.inputs[i.name] || ""}
                          onChange={(e) =>
                            update("inputs", {
                              ...request.inputs,
                              [i.name]: e.target.value,
                            })
                          }
                        />
                      </>
                    )}
                    {i.description && (
                      <p className="field-help">{i.description}</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="advanced-trigger">
                Files and runner options
                <ChevronDown className="size-4" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="field-stack pt-3">
              {(
                [
                  ["eventFile", "Event payload (JSON)"],
                  ["envFile", "Environment file"],
                  ["varFile", "Variables file"],
                  ["secretFile", "Secrets file"],
                ] as const
              ).map(([key, label]) => (
                <div className="field" key={key}>
                  <Label htmlFor={key}>{label}</Label>
                  <div className="file-field">
                    <Input
                      id={key}
                      placeholder="Optional · relative to project or absolute"
                      value={request[key] || ""}
                      onChange={(e) => update(key, e.target.value || undefined)}
                    />
                    {isDesktop() && (
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={"Choose " + label.toLowerCase()}
                        onClick={async () => {
                          const path = await chooseFile();
                          if (path) update(key, path);
                        }}
                      >
                        <File className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              <Choice
                id="architecture"
                label="Container architecture"
                value={request.architecture}
                onChange={(v) => update("architecture", v)}
                options={[
                  { value: "auto", label: "Automatic (host architecture)" },
                  {
                    value: "linux/amd64",
                    label: "Linux AMD64 (emulated on Apple Silicon)",
                  },
                ]}
              />
              <p className="field-help">
                File contents are never stored in Act Dock. Existing .actrc
                settings still apply.
              </p>
            </CollapsibleContent>
          </Collapsible>
          <div className="command-preview">
            <span>Command preview</span>
            <code>
              act {request.event} -W {w.path}
              {request.jobId ? " -j " + request.jobId : ""} --json --rm
              {Object.keys(request.inputs).length ? " --input …" : ""} -P
              ubuntu-latest=catthehacker/ubuntu:act-latest
            </code>
            <p>
              File references and runner mappings are added at execution. act
              also reads your .actrc files.
            </p>
          </div>
          <div className="check-row">
            <Checkbox
              id="save-defaults"
              checked={save}
              onCheckedChange={(v) => setSave(v === true)}
            />
            <Label htmlFor="save-defaults">
              Remember file references and runner options for this project
            </Label>
          </div>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            <Play className="size-4" />
            {busy ? "Queueing…" : "Run workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
