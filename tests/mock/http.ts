/**
 * A minimal HTTP harness mirroring the real server's src/http.ts bridge:
 * node:http in front of the v2 SDK's createMcpHandler (stateless legacy
 * fallback), static bearer-token auth answered with the RFC 9728-style 401
 * challenge, and the optional /memory path prefix stripped.
 */

import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toWebRequest } from "@modelcontextprotocol/node";
import { createMockServer } from "./server.js";

export interface HttpHarness {
  /** Base origin, e.g. http://127.0.0.1:49152 — append /mcp or /memory/mcp. */
  origin: string;
  close(): Promise<void>;
}

export async function startHttpHarness(token: string): Promise<HttpHarness> {
  const handler = createMcpHandler(() => createMockServer().server, { legacy: "stateless" });

  const server: Server = createHttpServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const pathname = url.pathname.replace(/^\/memory(?=\/|$)/, "") || "/";

      if (pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (pathname !== "/mcp" && pathname !== "/") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, {
          "content-type": "application/json",
          "www-authenticate": 'Bearer resource_metadata="http://127.0.0.1/.well-known/oauth-protected-resource"',
        });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      const request = await toWebRequest(req as Parameters<typeof toWebRequest>[0]);
      const response = await handler.fetch(request, {
        authInfo: { token: "resolved", clientId: "harness", scopes: [] },
      });
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      if (response.body) {
        for await (const chunk of response.body) {
          res.write(chunk);
        }
      }
      res.end();
    })().catch(() => {
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}
