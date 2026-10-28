import { randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "../../shared/contracts";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type OutgoingHttpHeaders,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as tcpConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
/** Enforce cached-only acquisition even if working files change after inspection.
 * Only the Act host process receives this proxy. Job containers retain their network.
 */
export async function actionSourceGuard(
  environment: NodeJS.ProcessEnv,
  servers: string[],
) {
  const denied = new Set(
    servers.map((server) =>
      new URL(`https://${server}`).hostname.toLowerCase(),
    ),
  );
  const sockets = new Set<Socket>();
  const token = randomBytes(32).toString("hex"),
    authorization = `Basic ${Buffer.from(`act-dock:${token}`).toString("base64")}`;
  const authorized = (request: IncomingMessage) => {
    const value = Buffer.from(request.headers["proxy-authorization"] || ""),
      expected = Buffer.from(authorization);
    return value.length === expected.length && timingSafeEqual(value, expected);
  };
  const parseProxy = (raw: string | undefined) => {
    if (!raw) return undefined;
    try {
      const proxy = new URL(raw);
      if (!["http:", "https:"].includes(proxy.protocol)) throw new Error();
      decodeURIComponent(proxy.username);
      decodeURIComponent(proxy.password);
      return proxy;
    } catch {
      throw new AppError(
        "PROXY_CONFIGURATION",
        "The configured HTTP proxy URL is invalid. Correct proxy settings before using cached-only action sources.",
      );
    }
  };
  const httpProxy = parseProxy(
      environment.HTTP_PROXY || environment.http_proxy,
    ),
    httpsProxy =
      parseProxy(environment.HTTPS_PROXY || environment.https_proxy) ||
      httpProxy;
  const upstream = (secure: boolean) => (secure ? httpsProxy : httpProxy);
  const forbidden = (host: string) => denied.has(host.toLowerCase());
  const proxyAuthorization = (proxy: URL) =>
    proxy.username
      ? `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`
      : undefined;
  const server = createServer((incoming, response) => {
    if (!authorized(incoming)) {
      response
        .writeHead(407, { "Proxy-Authenticate": "Basic realm=ActDock" })
        .end();
      return;
    }
    let target: URL;
    try {
      target = new URL(incoming.url || "");
      if (!["http:", "https:"].includes(target.protocol)) throw new Error();
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (forbidden(target.hostname)) {
      response
        .writeHead(403)
        .end("Action sources are restricted to cached content.");
      return;
    }
    const proxy = upstream(target.protocol === "https:"),
      headers: OutgoingHttpHeaders = { ...incoming.headers, host: target.host };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    if (proxy) {
      const auth = proxyAuthorization(proxy);
      if (auth) headers["proxy-authorization"] = auth;
    }
    const destination = proxy || target,
      transport =
        destination.protocol === "https:" ? httpsRequest : httpRequest;
    const forwarded = transport(
      {
        hostname: destination.hostname,
        port: destination.port || undefined,
        path: proxy ? target.href : target.pathname + target.search,
        method: incoming.method,
        headers,
      },
      (received) => {
        response.writeHead(received.statusCode || 502, received.headers);
        received.pipe(response);
      },
    );
    forwarded.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    incoming.on("error", () => forwarded.destroy());
    incoming.pipe(forwarded);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("connect", (incoming: IncomingMessage, client, head) => {
    if (!authorized(incoming)) {
      client.end(
        "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=ActDock\r\n\r\n",
      );
      return;
    }
    let target: URL;
    try {
      target = new URL(`https://${incoming.url}`);
    } catch {
      client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    if (forbidden(target.hostname)) {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const proxy = upstream(true),
      destination = proxy || target;
    const remote =
      proxy?.protocol === "https:"
        ? tlsConnect({
            host: destination.hostname,
            port: Number(destination.port || 443),
            servername: destination.hostname,
          })
        : tcpConnect({
            host: destination.hostname,
            port: Number(destination.port || (proxy ? 80 : 443)),
          });
    sockets.add(remote);
    remote.on("close", () => sockets.delete(remote));
    remote.on("error", () => client.destroy());
    client.on("error", () => remote.destroy());
    const pipe = () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) remote.write(head);
      client.pipe(remote);
      remote.pipe(client);
    };
    remote.once(
      proxy?.protocol === "https:" ? "secureConnect" : "connect",
      () => {
        if (!proxy) {
          pipe();
          return;
        }
        const auth = proxyAuthorization(proxy);
        remote.write(
          `CONNECT ${target.host} HTTP/1.1\r\nHost: ${target.host}\r\n${auth ? `Proxy-Authorization: ${auth}\r\n` : ""}\r\n`,
        );
        let buffered = Buffer.alloc(0);
        const read = (chunk: Buffer) => {
          buffered = Buffer.concat([buffered, chunk]);
          if (buffered.length > 65536) {
            remote.destroy();
            client.destroy();
            return;
          }
          const end = buffered.indexOf("\r\n\r\n");
          if (end < 0) return;
          remote.off("data", read);
          if (
            !/^HTTP\/1\.[01] 200\b/.test(buffered.toString("ascii", 0, end))
          ) {
            remote.destroy();
            client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
            return;
          }
          const remainder = buffered.subarray(end + 4);
          pipe();
          if (remainder.length) client.write(remainder);
        };
        remote.on("data", read);
      },
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.unref();
  const port = (server.address() as { port: number }).port,
    url = `http://act-dock:${token}@127.0.0.1:${port}`;
  // Remove only bypasses that would let an action-source host evade the guard.
  const bypass = (environment.NO_PROXY || environment.no_proxy || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(
      (value) =>
        value &&
        value !== "*" &&
        ![...denied].some(
          (host) =>
            host === value.split(":")[0] ||
            host.endsWith(value.replace(/^\*?\.?/, ".")),
        ),
    );
  return {
    redactions: [token, url, authorization],
    environment: {
      ...environment,
      HTTP_PROXY: url,
      HTTPS_PROXY: url,
      http_proxy: url,
      https_proxy: url,
      NO_PROXY: bypass.join(","),
      no_proxy: bypass.join(","),
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
