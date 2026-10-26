import {
  AppError,
  parseResponse,
  serviceReplySchema,
  type Method,
  type Results,
  type ServiceReply,
} from "../../shared/contracts";
import type { DesktopRPC } from "../../shared/rpc";
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
