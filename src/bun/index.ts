import {
  BrowserWindow,
  BrowserView,
  Updater,
  Utils,
  PATHS,
  ApplicationMenu,
} from "electrobun/main";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { call, ensureRunner, installRunner } from "../runner/client";
import { AppError, errorMessage } from "../shared/contracts";
import type { DesktopRPC } from "../shared/rpc";
const bundled = join(PATHS.RESOURCES_FOLDER, "app", "act-dock");
if (existsSync(bundled)) await installRunner(bundled);
const rpc = BrowserView.defineRPC<DesktopRPC>({
  handlers: {
    requests: {
      service: async ({ method, params }) => {
        try {
          return {
            ok: true as const,
            data: await call(method, params || {}, "desktop"),
          };
        } catch (e) {
          return {
            ok: false as const,
            error: {
              code: e instanceof AppError ? e.code : "ERROR",
              message: errorMessage(e),
            },
          };
        }
      },
      chooseFolder: async () =>
        (
          await Utils.openFileDialog({
            canChooseFiles: false,
            canChooseDirectory: true,
            allowsMultipleSelection: false,
          })
        )[0] || null,
      chooseFile: async () =>
        (
          await Utils.openFileDialog({
            canChooseFiles: true,
            canChooseDirectory: false,
            allowsMultipleSelection: false,
          })
        )[0] || null,
      restartRunner: async () => {
        await ensureRunner();
        return true;
      },
      exportLogs: async ({ runId }) => {
        const folder = (
          await Utils.openFileDialog({
            canChooseFiles: false,
            canChooseDirectory: true,
            allowsMultipleSelection: false,
          })
        )[0];
        if (!folder) return null;
        let cursor = 0;
        const lines: string[] = [];
        for (;;) {
          const page = await call(
            "get_run_logs",
            { runId, cursor, limit: 2000 },
            "desktop",
          );
          lines.push(
            ...page.entries.map((e) => `${e.time} [${e.stream}] ${e.message}`),
          );
          if (!page.entries.length || page.end) break;
          cursor = page.nextCursor;
        }
        const path = join(folder, `act-dock-${runId}.log`);
        await Bun.write(path, lines.join("\n"));
        return path;
      },
    },
    messages: {},
  },
});
let url = "views://mainview/index.html";
if ((await Updater.localInfo.channel()) === "dev") {
  try {
    await fetch("http://localhost:5173", {
      method: "HEAD",
      signal: AbortSignal.timeout(1000),
    });
    url = "http://localhost:5173";
  } catch {}
}
ApplicationMenu.setApplicationMenu([
  {
    label: "Act Dock",
    submenu: [
      { label: "About Act Dock", role: "about" },
      { type: "divider" },
      { label: "Quit Act Dock", role: "quit" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { label: "Undo", role: "undo" },
      { label: "Redo", role: "redo" },
      { type: "divider" },
      { label: "Cut", role: "cut" },
      { label: "Copy", role: "copy" },
      { label: "Paste", role: "paste" },
      { label: "Select all", role: "selectAll" },
    ],
  },
]);
new BrowserWindow({
  title: "Act Dock",
  url,
  rpc,
  frame: { width: 1360, height: 860, x: 120, y: 90 },
});
