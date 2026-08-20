/**
 * Transport construction for AgentMemory.connect. HTTP is the primary path
 * (streamable HTTP + bearer token); stdio spawns the server's dist/stdio.js;
 * "custom" accepts any pre-built Transport (the test seam, and the escape
 * hatch for exotic setups).
 */

import type { Transport } from "@modelcontextprotocol/client";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

export const DEFAULT_URL = "http://127.0.0.1:3010/mcp";

/** Generous default: a cold Ollama embed on the server can take tens of
 *  seconds, and the server's own embed timeout is 30s per leg. */
export const DEFAULT_TIMEOUT_MS = 120_000;

export interface HttpConnectOptions {
  transport?: "http";
  /** MCP endpoint URL. Default: AGENT_MEMORY_URL env, else http://127.0.0.1:3010/mcp. */
  url?: string;
  /** Bearer token. Default: AGENT_MEMORY_TOKEN env. Omitted = unauthenticated. */
  token?: string;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /** Per-request timeout in ms. Default: AGENT_MEMORY_TIMEOUT_MS env, else 120000. */
  timeoutMs?: number;
  /** Protocol era negotiation: "legacy" (default, no probe round-trip) or "auto". */
  era?: "legacy" | "auto";
}

export interface StdioConnectOptions {
  transport: "stdio";
  /** Path to the server's dist/stdio.js. */
  serverPath: string;
  /** TOML config path, passed as --config. */
  configPath?: string;
  /** Executable to run serverPath with. Default: "node". */
  command?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface CustomTransportOptions {
  transport: "custom";
  instance: Transport;
  timeoutMs?: number;
}

export type ConnectOptions = HttpConnectOptions | StdioConnectOptions | CustomTransportOptions;

export function resolveTimeoutMs(options: ConnectOptions): number {
  if (options.timeoutMs !== undefined) {
    return options.timeoutMs;
  }
  const env = Number(process.env["AGENT_MEMORY_TIMEOUT_MS"]);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_TIMEOUT_MS;
}

export async function buildTransport(options: ConnectOptions): Promise<Transport> {
  if (options.transport === "custom") {
    return options.instance;
  }
  if (options.transport === "stdio") {
    const { StdioClientTransport } = await import("@modelcontextprotocol/client/stdio");
    return new StdioClientTransport({
      command: options.command ?? "node",
      args: [options.serverPath, ...(options.configPath ? ["--config", options.configPath] : [])],
      ...(options.env ? { env: options.env } : {}),
    });
  }
  const url = options.url ?? process.env["AGENT_MEMORY_URL"] ?? DEFAULT_URL;
  const token = options.token ?? process.env["AGENT_MEMORY_TOKEN"];
  return new StreamableHTTPClientTransport(new URL(url), {
    ...(token !== undefined ? { authProvider: { token: async () => token } } : {}),
    ...(options.headers ? { requestInit: { headers: options.headers } } : {}),
  });
}

export function buildClient(options: ConnectOptions): Client {
  const era = options.transport === undefined || options.transport === "http" ? (options.era ?? "legacy") : "legacy";
  return new Client(
    { name: "agent-memory-js", version: "0.1.0" },
    era === "auto" ? { versionNegotiation: { mode: "auto" } } : {},
  );
}
