import type { Plugin } from "vite";
import { request } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
// Development-only bridge. Production views use typed Electrobun RPC.
export function runnerBridge(): Plugin {
  return {
    name: "act-dock-runner-dev",
    configureServer(server) {
      server.middlewares.use("/__actdock/rpc", (req, res) => {
        if (
          req.method !== "POST" ||
          (req.headers.origin &&
            req.headers.origin !== `http://${req.headers.host}`)
        ) {
          res.statusCode = 403;
          res.end();
          return;
        }
        const socketPath = join(
          process.env.ACT_DOCK_DATA_DIR ||
            join(homedir(), "Library/Application Support/Act Dock"),
          "runner.sock",
        );
        const upstream = request(
          {
            socketPath,
            path: "/rpc",
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: (() => {
              try { return "Bearer " + readFileSync(join(socketPath, "..", "runner.key"), "utf8").trim(); } catch { return ""; }
            })() },
          },
          (r) => {
            res.setHeader("Content-Type", "application/json");
            res.statusCode = r.statusCode || 200;
            r.pipe(res);
          },
        );
        upstream.on("error", () => {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ok: false,
              error: {
                code: "RUNNER_OFFLINE",
                message:
                  "Start the runner with bun run cli runner start, then retry.",
              },
            }),
          );
        });
        req.pipe(upstream);
      });
    },
  };
}
