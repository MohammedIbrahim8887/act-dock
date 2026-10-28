import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Choice } from "./run-dialog";
import {
  defaultExecution,
  type ExecutionOptions,
} from "../../shared/contracts";

export function ExecutionFields({
  value,
  onChange,
  prefix = "execution",
}: {
  value: ExecutionOptions;
  onChange: (v: ExecutionOptions) => void;
  prefix?: string;
}) {
  const [label, setLabel] = useState(""),
    [reference, setReference] = useState("");
  const update = (patch: ExecutionOptions) => onChange({ ...value, ...patch });
  return (
    <div className="field-stack">
      <div className="form-grid">
        <Choice
          id={`${prefix}-pull`}
          label="Image downloads"
          value={value.imagePullPolicy || "if-missing"}
          onChange={(v) =>
            update({
              imagePullPolicy: v as ExecutionOptions["imagePullPolicy"],
            })
          }
          options={[
            { value: "if-missing", label: "Only when missing" },
            { value: "always", label: "Refresh before each run" },
            { value: "never", label: "Use local images only" },
          ]}
        />
        <Choice
          id={`${prefix}-actions`}
          label="Action sources"
          value={value.actionCachePolicy || "cache-first"}
          onChange={(v) =>
            update({
              actionCachePolicy: v as ExecutionOptions["actionCachePolicy"],
            })
          }
          options={[
            {
              value: "cache-first",
              label: "Cache first · refresh refs after 24 hours",
            },
            { value: "refresh", label: "Refresh every run" },
            { value: "cached-only", label: "Cached sources only" },
          ]}
        />
      </div>
      <details>
        <summary>Runner images</summary>
        <div className="field-stack pt-3">
          <p className="field-help">
            Medium images are the default. Full images require more disk space
            and do not reproduce every GitHub-hosted capability. Ubuntu 20.04 is
            legacy.
          </p>
          {Object.entries({
            ...defaultExecution.runnerMappings,
            ...value.runnerMappings,
          }).map(([key, image]) => (
            <div className="field" key={key}>
              <Label htmlFor={`${prefix}-${key}`}>{key}</Label>
              <div className="file-field">
                <Input
                  id={`${prefix}-${key}`}
                  className="mono"
                  value={image}
                  onChange={(e) =>
                    update({
                      runnerMappings: {
                        ...value.runnerMappings,
                        [key]: e.target.value,
                      },
                    })
                  }
                />
                {/^ubuntu-(latest|20\.04|22\.04|24\.04)$/.test(key) && (
                  <Button
                    variant="outline"
                    aria-label={`${image.includes(":full-") ? "Use medium" : "Use full"} image for ${key}`}
                    onClick={() =>
                      update({
                        runnerMappings: {
                          ...value.runnerMappings,
                          [key]: `catthehacker/ubuntu:${image.includes(":full-") ? "act" : "full"}-${key === "ubuntu-latest" ? "24.04" : key.replace("ubuntu-", "")}`,
                        },
                      })
                    }
                  >
                    {image.includes(":full-") ? "Use medium" : "Use full"}
                  </Button>
                )}
              </div>
            </div>
          ))}
          <div className="form-grid">
            <div className="field">
              <Label htmlFor={`${prefix}-label`}>Custom Linux label</Label>
              <Input
                id={`${prefix}-label`}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="my-linux-runner"
              />
            </div>
            <div className="field">
              <Label htmlFor={`${prefix}-reference`}>
                Docker image reference
              </Label>
              <Input
                id={`${prefix}-reference`}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="registry.example/team/runner:tag"
              />
            </div>
          </div>
          <Button
            variant="outline"
            disabled={!label || !reference}
            onClick={() => {
              update({
                runnerMappings: { ...value.runnerMappings, [label]: reference },
              });
              setLabel("");
              setReference("");
            }}
          >
            Add mapping
          </Button>
        </div>
      </details>
      <details>
        <summary>Caches and resource reservations</summary>
        <div className="field-stack pt-3">
          <p className="field-help">
            Package caches retain downloads in project-specific volumes.
            Containers and node_modules stay fresh.
          </p>
          {(["npm", "pnpm", "bun"] as const).map((kind) => (
            <div className="check-row" key={kind}>
              <Checkbox
                id={`${prefix}-${kind}`}
                checked={value.packageCaches?.includes(kind) || false}
                onCheckedChange={(checked) =>
                  update({
                    packageCaches: checked
                      ? [...(value.packageCaches || []), kind]
                      : (value.packageCaches || []).filter((k) => k !== kind),
                  })
                }
              />
              <Label htmlFor={`${prefix}-${kind}`}>{kind} download cache</Label>
            </div>
          ))}
          {value.packageCaches?.includes("pnpm") && (
            <p className="field-help">
              Configure your workflow explicitly:{" "}
              <code>pnpm install --store-dir /var/cache/act-dock/pnpm</code>
            </p>
          )}
          <div className="form-grid">
            {(["cpus", "memoryGiB"] as const).map((key) => (
              <div className="field" key={key}>
                <Label htmlFor={`${prefix}-${key}`}>
                  {key === "cpus" ? "Reserved CPUs" : "Reserved memory (GiB)"}
                </Label>
                <Input
                  id={`${prefix}-${key}`}
                  type="number"
                  min="0.25"
                  step="0.25"
                  value={value.reservation?.[key] ?? 2}
                  onChange={(e) =>
                    update({
                      reservation: {
                        cpus: 2,
                        memoryGiB: 2,
                        ...value.reservation,
                        [key]: Number(e.target.value),
                      },
                    })
                  }
                />
              </div>
            ))}
          </div>
          <p className="field-help">
            Reservations control scheduling. They are not container CPU or
            memory limits.
          </p>
          <Choice
            id={`${prefix}-workspace`}
            label="Workspace"
            value={value.workspaceMode || "copy"}
            onChange={(v) => update({ workspaceMode: v as "copy" | "bind" })}
            options={[
              {
                value: "copy",
                label: "Copy current files into fresh containers",
              },
              {
                value: "bind",
                label: "Bind project files · commands can modify them",
              },
            ]}
          />
          <div className="field">
            <Label htmlFor={`${prefix}-jobs`}>Parallel jobs inside Act</Label>
            <Input
              id={`${prefix}-jobs`}
              type="number"
              min="1"
              max="64"
              placeholder="Automatic · Act default"
              value={value.concurrentJobs ?? ""}
              onChange={(e) =>
                update({
                  concurrentJobs: e.target.value
                    ? Number(e.target.value)
                    : undefined,
                })
              }
            />
          </div>
        </div>
      </details>
    </div>
  );
}
