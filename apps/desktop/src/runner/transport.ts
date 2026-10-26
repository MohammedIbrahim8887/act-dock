import { createServer, request } from "node:http";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { socketPath, tokenPath } from "./paths";

export function localRequest(body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let token = "";
    try { token = readFileSync(tokenPath, "utf8").trim(); } catch {}
    const req = request({ socketPath, path: "/rpc", method: "POST", headers: {
      "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}),
    } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(Buffer.from(chunk)));
      res.on("error", reject);
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (error) { reject(error); }
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error("Runner request timed out")));
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

export async function listenLocal(handler: (body: unknown) => Promise<Response>) {
  const token = randomBytes(32).toString("hex");
  writeFileSync(tokenPath, token, { mode: 0o600 });
  const server = createServer(async (req, res) => {
    // The Windows pipe has a per-user name; a private per-install key also
    // authenticates clients. No interface binds a TCP port.
    const provided = Buffer.from(req.headers.authorization || "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED", message: "Runner credentials changed. Reconnect to Act Dock." } }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/rpc") { res.writeHead(404); res.end(); return; }
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) { res.writeHead(413); res.end(); return; }
        chunks.push(Buffer.from(chunk));
      }
      const reply = await handler(JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(reply.status, { "Content-Type": "application/json" });
      res.end(await reply.text());
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: { code: "INVALID_REQUEST", message: "Expected a JSON RPC request." } }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => { server.off("error", reject); resolve(); });
  });
  if (process.platform !== "win32") chmodSync(socketPath, 0o600);
  return { stop: async (_force?: boolean) => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
