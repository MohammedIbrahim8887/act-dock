import { useEffect, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronRight,
  Folder,
  FolderOpen,
  Home,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { api, chooseFolder, isDesktop } from "@/lib/api";
import type { FolderListing, Project } from "../../shared/contracts";
import { fail } from "./common";

export function AddProjectDialog({
  onClose,
  onAdded,
  initialPath,
}: {
  onClose: () => void;
  onAdded: (p: Project) => void;
  initialPath?: string;
}) {
  const [selected, setSelected] = useState(""),
    [browsing, setBrowsing] = useState(!isDesktop());
  const [target, setTarget] = useState<string | undefined>(initialPath),
    [listing, setListing] = useState<FolderListing | null>(null);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [hidden, setHidden] = useState(false),
    [query, setQuery] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!browsing) return;
    let alive = true;
    setLoading(true);
    setError("");
    setQuery("");
    void api("browse_folders", { path: target, showHidden: hidden })
      .then((value) => {
        if (alive) setListing(value);
      })
      .catch((e) => {
        if (alive) setError(fail(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [browsing, target, hidden, retry]);
  async function pickNative() {
    setBusy(true);
    setError("");
    try {
      const folder = await chooseFolder();
      if (folder) setSelected(folder);
    } catch (e) {
      setError(fail(e));
    } finally {
      setBusy(false);
    }
  }
  async function add() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      onAdded(await api("add_project", { path: selected }));
      onClose();
    } catch (e) {
      setError(fail(e));
    } finally {
      setBusy(false);
    }
  }
  function navigate(path: string) {
    setLoading(true);
    setTarget(path);
    setRetry((value) => value + 1);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="project-dialog">
        <DialogHeader>
          <DialogTitle>
            {browsing ? "Choose a project folder" : "Add a project"}
          </DialogTitle>
          <DialogDescription>
            {browsing
              ? "Open folders below, then select the folder containing your project."
              : "Choose a local project to discover and run its GitHub Actions workflows."}
          </DialogDescription>
        </DialogHeader>
        {browsing ? (
          <div className="folder-picker">
            <div className="folder-shortcuts">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setTarget(undefined);
                  setRetry((v) => v + 1);
                }}
              >
                <Home className="size-4" />
                Home
              </Button>
              {listing?.shortcuts
                .filter((s) => s.name !== "Home")
                .map((s) => (
                  <Button
                    key={s.path}
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(s.path)}
                  >
                    {s.name}
                  </Button>
                ))}
            </div>
            <div className="folder-location">
              <Button
                variant="outline"
                size="icon"
                aria-label="Up one folder"
                disabled={!listing?.parentPath || loading}
                onClick={() => {
                  if (listing?.parentPath) navigate(listing.parentPath);
                }}
              >
                <ArrowUp className="size-4" />
              </Button>
              <span className="mono" title={target || listing?.path}>
                {target || listing?.path || "Home"}
              </span>
            </div>
            <Input
              aria-label="Find a folder"
              placeholder="Find a folder in this location…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={loading}
            />
            {error ? (
              <div className="form-error" role="alert">
                <p>{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRetry((v) => v + 1)}
                >
                  <RefreshCw className="size-3" />
                  Retry
                </Button>
              </div>
            ) : (
              <ScrollArea
                className="folder-list"
                viewportLabel="Project folders"
              >
                {loading ? (
                  <div className="p-3 space-y-3">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : (
                  listing?.folders
                    .filter((f) =>
                      f.name.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((folder) => (
                      <Button
                        className="folder-row"
                        key={folder.path}
                        variant="ghost"
                        onClick={() => navigate(folder.path)}
                      >
                        <Folder className="size-4" />
                        <span>{folder.name}</span>
                        <ChevronRight className="ml-auto size-3.5" />
                      </Button>
                    ))
                )}
                {!loading &&
                  listing &&
                  !listing.folders.some((f) =>
                    f.name.toLowerCase().includes(query.toLowerCase()),
                  ) && (
                    <p className="folder-empty">
                      {query
                        ? "No folders match your search."
                        : "No subfolders. You can select this folder."}
                    </p>
                  )}
              </ScrollArea>
            )}
            <div className="check-row">
              <Checkbox
                id="hidden-folders"
                checked={hidden}
                onCheckedChange={(value) => setHidden(value === true)}
              />
              <Label htmlFor="hidden-folders">Show hidden folders</Label>
            </div>
            {!loading && !error && listing && (
              <p className="folder-hint">
                {listing.hasWorkflows ? (
                  <>
                    <Check className="size-3.5" />
                    GitHub Actions workflows found in this folder.
                  </>
                ) : (
                  "No .github/workflows folder here yet. You can add workflows later."
                )}
              </p>
            )}
          </div>
        ) : (
          <div className="project-selection">
            <div className="project-selection-icon">
              <FolderOpen className="size-6" />
            </div>
            <Label>Project folder</Label>
            <p
              className={selected ? "mono selected-project-path" : "field-help"}
            >
              {selected ||
                "Select a folder from your computer. No path to type."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (isDesktop()) void pickNative();
                  else {
                    setTarget(selected || initialPath);
                    setBrowsing(true);
                    setError("");
                  }
                }}
                disabled={busy}
              >
                <FolderOpen className="size-4" />
                {selected ? "Change folder" : "Choose folder"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setTarget(selected || undefined);
                  setBrowsing(true);
                  setError("");
                }}
                disabled={busy}
              >
                Browse folders
              </Button>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={
              browsing && selected
                ? () => {
                    setBrowsing(false);
                    setError("");
                  }
                : onClose
            }
            disabled={busy}
          >
            {browsing && selected ? "Back" : "Cancel"}
          </Button>
          {browsing ? (
            <Button
              disabled={loading || !!error || !listing}
              onClick={() => {
                if (listing) {
                  setSelected(listing.path);
                  setBrowsing(false);
                  setError("");
                }
              }}
            >
              <Check className="size-4" />
              Select this folder
            </Button>
          ) : (
            <Button disabled={!selected || busy} onClick={() => void add()}>
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <FolderOpen className="size-4" />
              )}
              {busy ? "Adding…" : "Add project"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
