import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Choice } from "./run-dialog";
import { ExecutionFields } from "./execution-options";
import { api, chooseFile } from "@/lib/api";
import { subscribeEvents } from "@/lib/events";
import { fail } from "./common";
import type {
  Project,
  SecretMetadata,
  CacheEntry,
  ExecutionOptions,
  ExecutionSnapshot,
} from "../../shared/contracts";
export function ProjectExecution({
  project,
  onSaved,
}: {
  project: Project;
  onSaved: (p: Project) => void;
}) {
  const [inherited, setInherited] = useState<ExecutionSnapshot | null>(null),
    [remove, setRemove] = useState<SecretMetadata | null>(null);
  const secretName = useRef<HTMLInputElement>(null);
  const [options, setOptions] = useState<ExecutionOptions>(
      project.defaults.execution || {},
    ),
    [secrets, setSecrets] = useState<SecretMetadata[]>([]),
    [caches, setCaches] = useState<CacheEntry[]>([]),
    [name, setName] = useState(""),
    [value, setValue] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [path, setPath] = useState(""),
    [target, setTarget] = useState<"env" | "vars" | "secrets">("secrets"),
    [preview, setPreview] = useState<{
      names: string[];
      duplicates: string[];
    } | null>(null),
    [overwrite, setOverwrite] = useState(false);
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
      if (events.some((event) => event.kind === "settings"))
        void load().catch((e) => setError(fail(e)));
    });
  }, [project.id]);
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
  return (
    <details className="project-execution">
      <summary>Project settings</summary>
      <div className="field-stack pt-3">
        <h2>Execution preferences</h2>
        <p className="field-help">
          Inherited global and .actrc preferences apply unless you change a
          field here. Only project overrides are saved.
        </p>
        {!inherited && <p role="status">Loading inherited preferences…</p>}
        {inherited && (
          <>
            <ExecutionFields
              prefix={`project-${project.id}`}
              value={{
                ...inherited.options,
                ...options,
                runnerMappings: {
                  ...inherited.options.runnerMappings,
                  ...options.runnerMappings,
                },
              }}
              onChange={(next) =>
                setOptions((previous) => {
                  const effective = {
                      ...inherited.options,
                      ...previous,
                      runnerMappings: {
                        ...inherited.options.runnerMappings,
                        ...previous.runnerMappings,
                      },
                    },
                    patch = { ...previous };
                  for (const key of Object.keys(
                    next,
                  ) as (keyof ExecutionOptions)[])
                    if (
                      JSON.stringify(next[key]) !==
                      JSON.stringify(effective[key])
                    ) {
                      if (key === "runnerMappings")
                        patch.runnerMappings = {
                          ...previous.runnerMappings,
                          ...Object.fromEntries(
                            Object.entries(next.runnerMappings || {}).filter(
                              ([label, image]) =>
                                image !== effective.runnerMappings[label],
                            ),
                          ),
                        };
                      else Object.assign(patch, { [key]: next[key] });
                    }
                  return patch;
                })
              }
            />
            <details>
              <summary>Configuration provenance</summary>
              <dl>
                {Object.entries(inherited.provenance).map(([key, source]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{key in options ? "Project override" : source}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <Button variant="ghost" onClick={() => setOptions({})}>
              Use inherited preferences
            </Button>
          </>
        )}
        <Button
          variant="outline"
          disabled={busy || !inherited}
          onClick={() =>
            void perform(async () => {
              onSaved(
                await api("save_defaults", {
                  projectId: project.id,
                  defaults: { ...project.defaults, execution: options },
                }),
              );
              toast.success("Project preferences saved");
            })
          }
        >
          Save preferences
        </Button>
        <details>
          <summary>Secrets &amp; environment</summary>
          <div className="field-stack pt-3">
            <p className="field-help">
              Saved values live in your system vault and are write-only here.
              Granted names are available to this project’s desktop, CLI and MCP
              runs.
            </p>
            {secrets.map((s) => (
              <div className="setting-row" key={s.id}>
                <div>
                  <strong className="mono">{s.name}</strong>
                  <p>
                    {s.granted ? "Granted to this project" : "Not granted"} ·
                    updated {new Date(s.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  disabled={busy}
                  variant="ghost"
                  onClick={() => setRemove(s)}
                >
                  Delete {s.name}
                </Button>
              </div>
            ))}
            {!secrets.length && (
              <p className="field-help">
                No saved secrets. Existing secret files still work.
              </p>
            )}
            <div className="field">
              <Label htmlFor="secret-name">Secret name</Label>
              <Input
                id="secret-name"
                ref={secretName}
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value.toUpperCase())}
                placeholder="DEPLOY_TOKEN"
              />
            </div>
            <div className="field">
              <Label htmlFor="secret-value">New value</Label>
              <Textarea
                id="secret-value"
                autoComplete="off"
                spellCheck={false}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Paste a new value. Saved values cannot be viewed."
              />
            </div>
            <Button
              disabled={busy || !name || !value}
              onClick={() =>
                void perform(async () => {
                  await api("put_project_secret", {
                    projectId: project.id,
                    name,
                    value,
                    granted: true,
                  });
                  setOptions((o) => ({
                    ...o,
                    secretNames: [...new Set([...(o.secretNames || []), name])],
                  }));
                  setName("");
                  setValue("");
                  toast.success("Secret saved in system vault");
                })
              }
            >
              Save secret
            </Button>
            <h3>Import a dotenv file</h3>
            <div className="field">
              <Label htmlFor="import-path">File path</Label>
              <div className="file-field">
                <Input
                  id="import-path"
                  value={path}
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
                  Choose file
                </Button>
              </div>
            </div>
            <Choice
              id="import-target"
              label="Import destination"
              value={target}
              onChange={(v) => {
                setTarget(v as typeof target);
                setPreview(null);
              }}
              options={[
                { value: "secrets", label: "System vault · secrets" },
                { value: "env", label: "Environment variables · private file" },
                { value: "vars", label: "Workflow variables · private file" },
              ]}
            />
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
              Preview names
            </Button>
            {preview && (
              <>
                <p className="field-help">
                  Names: {preview.names.join(", ") || "None"}. Already saved:{" "}
                  {preview.duplicates.join(", ") || "None"}.
                </p>
                <Choice
                  id="duplicate-policy"
                  label="Duplicate names"
                  value={String(overwrite)}
                  onChange={(v) => setOverwrite(v === "true")}
                  options={[
                    { value: "false", label: "Keep existing values" },
                    { value: "true", label: "Replace existing values" },
                  ]}
                />
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
                      toast.success("Import complete");
                    })
                  }
                >
                  Import {preview.names.length} names
                </Button>
              </>
            )}
          </div>
        </details>
        <details>
          <summary>Cache storage</summary>
          <div className="field-stack pt-3">
            <p className="field-help">
              Global cache budgets apply (defaults: 5 GiB per project, 20 GiB
              overall). Inactive caches are evicted oldest first. Unknown sizes
              cannot be counted toward those budgets.
            </p>
            {caches.map((c) => (
              <div className="setting-row" key={c.id}>
                <div>
                  <strong>{c.kind}</strong>
                  <p>
                    {c.bytes === null
                      ? "Size unknown"
                      : `${(c.bytes / 1024 ** 2).toFixed(1)} MiB`}{" "}
                    · {c.leases ? "In use" : "Inactive"}
                  </p>
                  <code className="technical-wrap">
                    {String(c.metadata.url || c.path)}
                  </code>
                </div>
                <Button
                  variant="ghost"
                  disabled={busy || !!c.leases}
                  onClick={() =>
                    void perform(() => api("clear_cache", { cacheId: c.id }))
                  }
                >
                  Clear
                </Button>
              </div>
            ))}
            {!caches.length && (
              <p className="field-help">
                No managed caches yet. Run a workflow to populate them.
              </p>
            )}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void perform(() =>
                  api("refresh_project_cache", { projectId: project.id }),
                )
              }
            >
              Clear inactive project caches
            </Button>
          </div>
        </details>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <AlertDialog
          open={!!remove}
          onOpenChange={(open) => {
            if (!open) setRemove(null);
          }}
        >
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              secretName.current?.focus();
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
                      setOptions((previous) => ({
                        ...previous,
                        secretNames: previous.secretNames?.filter(
                          (name) => name !== selected.name,
                        ),
                      }));
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
    </details>
  );
}
