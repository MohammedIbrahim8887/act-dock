import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpCircle,
  CircleAlert,
  CircleCheck,
  Download,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { openExternal, updateRequest } from "@/lib/api";
import { fail } from "./common";
import { SettingBlock, formatBytes, relativeTime } from "./execution-editor";
import {
  RELEASE_REPOSITORY,
  type InstallKind,
  type UpdatePreferences,
  type UpdateState,
} from "../../shared/updates";

type Action =
  | "checkForUpdates"
  | "downloadUpdate"
  | "installUpdate"
  | "postponeUpdate"
  | "setUpdatePreferences";
export type Updates = ReturnType<typeof useUpdates>;

/** Poll the desktop updater: every second while something is moving, otherwise every 30s. */
export function useUpdates() {
  const [state, setState] = useState<UpdateState | null>(null),
    [pending, setPending] = useState<Action | null>(null),
    [, tick] = useState(0);
  const refresh = useCallback(
    () =>
      updateRequest("getUpdateState")
        .then(setState)
        .catch(() => {}),
    [],
  );
  const live =
    !!state &&
    (["checking", "downloading", "installing"].includes(state.status) ||
      state.installAt !== undefined);
  useEffect(() => {
    void refresh();
    const timer = setInterval(
      () => {
        void refresh();
        tick((n) => n + 1);
      },
      live ? 1000 : 30000,
    );
    return () => clearInterval(timer);
  }, [live, refresh]);
  async function act(name: Action, params?: Partial<UpdatePreferences>) {
    setPending(name);
    try {
      setState(await updateRequest(name, params));
    } catch (e) {
      toast.error(fail(e));
      void refresh();
    } finally {
      setPending(null);
    }
  }
  return {
    state,
    pending,
    check: () => act("checkForUpdates"),
    download: () => act("downloadUpdate"),
    install: () => act("installUpdate"),
    postpone: () => act("postponeUpdate"),
    setPreferences: (p: Partial<UpdatePreferences>) =>
      act("setUpdatePreferences", p),
  };
}

const seconds = (at?: number) =>
  at === undefined ? 0 : Math.max(0, Math.ceil((at - Date.now()) / 1000));
const releaseUrl = (version?: string) =>
  `https://github.com/${RELEASE_REPOSITORY}/releases/${version ? `tag/v${version}` : "latest"}`;

const installCopy: Record<InstallKind, string> = {
  "macos-app":
    "Act Dock quits, replaces the app in its current folder with the verified new version, and opens again. If the swap fails, the previous version is put back.",
  "windows-installer":
    "Act Dock quits, runs the installer silently for your account in the same folder, and opens again.",
  "linux-appimage":
    "Act Dock quits, replaces this AppImage with the new one, and opens again.",
  "linux-deb":
    "Act Dock quits and installs the new .deb package. Your system asks for your password, then Act Dock opens again.",
  "linux-rpm":
    "Act Dock quits and installs the new .rpm package. Your system asks for your password, then Act Dock opens again.",
  development: "Development builds don't update themselves.",
  unsupported: "Download new versions from the Act Dock website.",
};

function headline(s: UpdateState) {
  switch (s.status) {
    case "checking":
      return "Checking for updates…";
    case "available":
      return `Act Dock ${s.version} is available`;
    case "downloading":
      return s.message === "Verifying…"
        ? `Verifying Act Dock ${s.version}`
        : `Downloading Act Dock ${s.version}`;
    case "ready":
      return `Act Dock ${s.version} is ready to install`;
    case "installing":
      return "Restarting to install…";
    case "error":
      return s.version ? `Act Dock ${s.version} couldn't be installed` : "Couldn't check for updates";
    case "unavailable":
      return "Automatic updates are off here";
    default:
      return "Act Dock is up to date";
  }
}

export function UpdatesPanel({ updates }: { updates: Updates }) {
  const { state: s, pending } = updates;
  if (!s)
    return (
      <div className="tab-stack">
        <div className="update-hero" data-status="checking">
          <span className="update-emblem">
            <LoaderCircle className="size-5 animate-spin" />
          </span>
          <div className="update-hero-text">
            <h3>Loading update status…</h3>
          </div>
        </div>
      </div>
    );
  const Icon =
    s.status === "idle"
      ? CircleCheck
      : s.status === "available"
        ? ArrowUpCircle
        : s.status === "ready"
          ? RotateCw
          : s.status === "error" || s.status === "unavailable"
            ? CircleAlert
            : s.status === "downloading"
              ? Download
              : LoaderCircle;
  const spinning = s.status === "checking" || s.status === "installing";
  const countdown = seconds(s.installAt);
  return (
    <div className="tab-stack">
      <div className="update-hero" data-status={s.status} aria-live="polite">
        <span className="update-emblem" aria-hidden="true">
          <Icon className={`size-5 ${spinning ? "animate-spin" : ""}`} />
        </span>
        <div className="update-hero-text">
          <h3>{headline(s)}</h3>
          {s.status === "downloading" ? (
            <>
              <div
                className="update-progress"
                role="progressbar"
                aria-label="Download progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((s.progress || 0) * 100)}
              >
                <span style={{ width: `${(s.progress || 0) * 100}%` }} />
              </div>
              <p>
                {s.message === "Verifying…"
                  ? "Checking the download against the release checksum…"
                  : `${formatBytes(s.downloadedBytes) || "0 B"} of ${formatBytes(s.totalBytes)} · ${Math.round((s.progress || 0) * 100)}%`}
              </p>
            </>
          ) : (
            <p>
              {s.status === "ready"
                ? s.waitingFor
                  ? `${s.waitingFor}, then Act Dock restarts to install it.`
                  : s.installAt !== undefined
                    ? `Restarting automatically in ${countdown}s. Pipelines keep running in the background.`
                    : "Act Dock will close, install the update and reopen. Pipelines keep running in the background."
                : s.status === "error" || s.status === "unavailable"
                  ? s.message
                  : s.status === "available"
                    ? `You’re on ${s.currentVersion}.${s.totalBytes ? ` ${formatBytes(s.totalBytes)} download.` : ""}`
                    : s.status === "installing"
                      ? "Act Dock will reopen on the new version in a moment."
                      : `You’re on version ${s.currentVersion}.${s.checkedAt ? ` Checked ${relativeTime(s.checkedAt)}.` : ""}`}
            </p>
          )}
        </div>
        <div className="update-hero-actions">
          {s.status === "available" && (
            <Button disabled={!!pending} onClick={() => void updates.download()}>
              <Download className="size-4" />
              Download
            </Button>
          )}
          {s.status === "ready" && (
            <>
              {s.installAt !== undefined && (
                <Button
                  variant="ghost"
                  disabled={!!pending}
                  onClick={() => void updates.postpone()}
                >
                  Not now
                </Button>
              )}
              <Button
                disabled={!!pending}
                onClick={() => void updates.install()}
              >
                <RotateCw className="size-4" />
                Restart and install
              </Button>
            </>
          )}
          {s.status === "error" && s.version && (
            <Button disabled={!!pending} onClick={() => void updates.download()}>
              <RefreshCw className="size-4" />
              Try again
            </Button>
          )}
          {["idle", "error", "available"].includes(s.status) &&
            !(s.status === "error" && s.version) && (
              <Button
                variant={s.status === "available" ? "ghost" : "outline"}
                disabled={!!pending}
                onClick={() => void updates.check()}
              >
                <RefreshCw
                  className={`size-4 ${pending === "checkForUpdates" ? "animate-spin" : ""}`}
                />
                Check for updates
              </Button>
            )}
          {s.status === "unavailable" && (
            <Button variant="outline" onClick={() => void openExternal(releaseUrl())}>
              <ExternalLink className="size-4" />
              Latest release
            </Button>
          )}
        </div>
      </div>
      {s.status !== "unavailable" && (
        <SettingBlock
          title="Automatic updates"
          description="Changes apply right away."
        >
          <ul className="toggle-list">
            <li>
              <div>
                <Label htmlFor="update-download">Download updates automatically</Label>
                <p>Get new versions in the background as soon as they’re released.</p>
              </div>
              <Switch
                id="update-download"
                checked={s.preferences.autoDownload}
                disabled={!!pending}
                onCheckedChange={(autoDownload) =>
                  void updates.setPreferences({ autoDownload })
                }
              />
            </li>
            <li>
              <div>
                <Label htmlFor="update-install">Install automatically</Label>
                <p>
                  Restart into a downloaded update after a one-minute notice,
                  and only when no pipelines are queued or running.
                </p>
              </div>
              <Switch
                id="update-install"
                checked={s.preferences.autoInstall}
                disabled={!!pending}
                onCheckedChange={(autoInstall) =>
                  void updates.setPreferences({ autoInstall })
                }
              />
            </li>
          </ul>
        </SettingBlock>
      )}
      <SettingBlock title="How updates install">
        <div className="update-facts">
          <p>{installCopy[s.installKind]}</p>
          <p className="update-fact">
            <ShieldCheck className="size-4" aria-hidden="true" />
            <span>
              Updates come only from Act Dock’s GitHub releases. Every download
              is checked against the release’s SHA-256 checksum before anything
              is installed{s.installKind === "macos-app" ? ", and the app’s code signature is verified" : ""}.
            </span>
          </p>
          <div className="update-links">
            <span>
              Installed version <code>{s.currentVersion}</code>
            </span>
            <button
              type="button"
              onClick={() => void openExternal(releaseUrl(s.version))}
            >
              {s.version ? `What’s new in ${s.version}` : "Release notes"}
              <ExternalLink className="size-3" />
            </button>
          </div>
        </div>
      </SettingBlock>
    </div>
  );
}

/** App-wide bar for an update that is ready, about to install, or installing. */
export function UpdateBanner({
  updates,
  onOpen,
}: {
  updates: Updates;
  onOpen: () => void;
}) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const s = updates.state;
  if (!s || !s.version) return null;
  const show =
    s.status === "installing" ||
    (s.status === "ready" && dismissed !== s.version) ||
    (s.status === "available" && !s.preferences.autoDownload && dismissed !== s.version);
  if (!show) return null;
  const countdown = seconds(s.installAt);
  return (
    <div className="update-banner" role="status" data-status={s.status}>
      {s.status === "installing" ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <ArrowUpCircle className="size-4" aria-hidden="true" />
      )}
      <span>
        <strong>
          {s.status === "installing"
            ? `Restarting to install Act Dock ${s.version}…`
            : s.status === "available"
              ? `Act Dock ${s.version} is available`
              : s.installAt !== undefined
                ? `Act Dock ${s.version} installs in ${countdown}s`
                : `Act Dock ${s.version} is ready`}
        </strong>
        {s.status === "ready" && (
          <span>
            {s.waitingFor
              ? `${s.waitingFor} first.`
              : "Act Dock reopens on its own. Pipelines keep running."}
          </span>
        )}
      </span>
      {s.status === "ready" && (
        <>
          <Button
            size="sm"
            disabled={!!updates.pending}
            onClick={() => void updates.install()}
          >
            Restart now
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (s.installAt !== undefined) void updates.postpone();
              else setDismissed(s.version!);
            }}
          >
            {s.installAt !== undefined ? "Not now" : "Later"}
          </Button>
        </>
      )}
      {s.status === "available" && (
        <>
          <Button size="sm" onClick={() => void updates.download()}>
            Download
          </Button>
          <Button size="sm" variant="ghost" onClick={onOpen}>
            Details
          </Button>
        </>
      )}
    </div>
  );
}

/** Small sidebar cue next to the version number. */
export function UpdateBadge({
  updates,
  onOpen,
}: {
  updates: Updates;
  onOpen: () => void;
}) {
  const s = updates.state;
  if (!s || !["available", "downloading", "ready"].includes(s.status)) return null;
  return (
    <button
      type="button"
      className="update-badge"
      onClick={onOpen}
      title={headline(s)}
    >
      <span className="update-badge-dot" aria-hidden="true" />
      {s.status === "downloading"
        ? `Updating ${Math.round((s.progress || 0) * 100)}%`
        : s.status === "ready"
          ? "Update ready"
          : "Update"}
    </button>
  );
}
