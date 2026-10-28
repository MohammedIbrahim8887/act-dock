import { requiredFeature, requireFeature } from "../../shared/capabilities";
import {
  AppError,
  parseResponse,
  serviceReplySchema,
  type Method,
  type Results,
  type ServiceReply,
} from "../../shared/contracts";
import type { DesktopRPC } from "../../shared/rpc";
import type { UpdatePreferences, UpdateState } from "../../shared/updates";
import { APP_VERSION } from "../../shared/version";
async function createConnection() {
  const { Electroview } = await import("electrobun/view");
  return new Electroview({
    rpc: Electroview.defineRPC<DesktopRPC>({
      maxRequestTime: 30000,
      handlers: { requests: {}, messages: {} },
    }),
  });
}
let desktop: ReturnType<typeof createConnection> | undefined;
function connection() {
  return (desktop ||= createConnection());
}
export const isDesktop = () => "__electrobunWebviewId" in window;
export async function api<M extends Method>(
  method: M,
  params: unknown = {},
): Promise<Results[M]> {
  const feature = requiredFeature(method, params);
  if (feature) {
    let capabilities;
    try {
      capabilities = await api("get_capabilities");
    } catch (error) {
      if (
        !(error instanceof AppError) ||
        !["VALIDATION_ERROR", "UNKNOWN_METHOD"].includes(error.code)
      )
        throw error;
      throw new AppError(
        "RUNNER_UPGRADE_REQUIRED",
        "Finish active work and reopen Act Dock to upgrade the background service.",
      );
    }
    requireFeature(feature, capabilities);
  }
  const reply: ServiceReply = isDesktop()
    ? await (await connection()).rpc!.request.service({ method, params })
    : await fetch("/__actdock/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, params, source: "desktop" }),
      }).then(async (r) => {
        if (!r.headers.get("content-type")?.includes("application/json"))
          throw new Error(
            "Open the desktop app or start the development runner.",
          );
        return r.json();
      });
  serviceReplySchema.parse(reply);
  if (!reply.ok) throw new AppError(reply.error.code, reply.error.message);
  return parseResponse(method, reply.data);
}
export async function chooseFolder() {
  return isDesktop()
    ? (await connection()).rpc!.request.chooseFolder(
        {},
        { maxRequestTime: Infinity },
      )
    : null;
}
export async function chooseFile() {
  return isDesktop()
    ? (await connection()).rpc!.request.chooseFile(
        {},
        { maxRequestTime: Infinity },
      )
    : null;
}
export async function exportLogs(runId: string) {
  if (isDesktop())
    return (await connection()).rpc!.request.exportLogs(
      { runId },
      { maxRequestTime: Infinity },
    );
  let cursor = 0;
  const lines: string[] = [];
  for (;;) {
    const p = await api("get_run_logs", { runId, cursor, limit: 2000 });
    lines.push(...p.entries.map((e) => `${e.time} [${e.stream}] ${e.message}`));
    if (!p.entries.length || p.end) break;
    cursor = p.nextCursor;
  }
  const url = URL.createObjectURL(
    new Blob([lines.join("\n")], { type: "text/plain" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `act-dock-${runId}.log`;
  a.click();
  URL.revokeObjectURL(url);
  return "Downloads";
}
export async function openExternal(url: string) {
  if (isDesktop())
    await (await connection()).rpc!.request.openExternal({ url });
  else window.open(url, "_blank", "noopener");
}
export async function revealPath(path: string) {
  if (isDesktop()) await (await connection()).rpc!.request.revealPath({ path });
}
type UpdateRequest =
  | "getUpdateState"
  | "checkForUpdates"
  | "downloadUpdate"
  | "installUpdate"
  | "postponeUpdate"
  | "setUpdatePreferences";
/** Talk to the desktop updater. Browser sessions report updates as unavailable. */
export async function updateRequest(
  name: UpdateRequest,
  params: Partial<UpdatePreferences> = {},
): Promise<UpdateState> {
  if (isDesktop())
    return (await connection()).rpc!.request[name](params as never, {
      maxRequestTime: 60000,
    }) as Promise<UpdateState>;
  if (import.meta.env.DEV) {
    const preview = new URLSearchParams(location.search).get("updates");
    if (preview) return previewUpdate(name, preview, params);
  }
  return {
    status: "unavailable",
    currentVersion: APP_VERSION,
    installKind: "development",
    message: "Updates are installed by the desktop app.",
    preferences: { autoDownload: true, autoInstall: true },
  };
}
/** Development-only simulator so every updater state can be reviewed in a browser. */
let preview: UpdateState | undefined;
function previewUpdate(
  name: UpdateRequest,
  start: string,
  params: Partial<UpdatePreferences>,
): UpdateState {
  preview ||= {
    status: start as UpdateState["status"],
    currentVersion: APP_VERSION,
    installKind: "macos-app",
    version: "0.2.6",
    publishedAt: new Date(Date.now() - 3600_000).toISOString(),
    checkedAt: new Date().toISOString(),
    totalBytes: 98_400_000,
    downloadedBytes: 41_200_000,
    progress: start === "ready" ? 1 : 0.42,
    installAt: start === "ready" ? Date.now() + 60_000 : undefined,
    message: start === "error" ? "The download didn't match the release checksum, so it was discarded." : undefined,
    preferences: { autoDownload: true, autoInstall: true },
  };
  if (name === "setUpdatePreferences")
    preview = { ...preview, preferences: { ...preview.preferences, ...params } };
  if (name === "postponeUpdate") preview = { ...preview, installAt: undefined };
  if (name === "checkForUpdates") preview = { ...preview, checkedAt: new Date().toISOString() };
  if (name === "downloadUpdate") preview = { ...preview, status: "downloading", message: undefined };
  if (name === "installUpdate") preview = { ...preview, status: "installing", installAt: undefined };
  return preview;
}
