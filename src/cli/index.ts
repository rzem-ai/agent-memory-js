#!/usr/bin/env node
/**
 * agent-memory-js — CLI over the typed client. One subcommand per tool
 * (tree/kv grouped), plus `tools`, `health`, and the plugin-facing `hook`
 * subcommands. Default output is the server's frozen text verbatim; --json
 * emits one machine envelope on stdout.
 */

import { parseArgs } from "node:util";
import { AgentMemory } from "../client.js";
import type { ConnectOptions } from "../connect.js";
import { DEFAULT_URL } from "../connect.js";
import { UsageError, emitError, emitOk, type OutputFlags } from "./output.js";

const USAGE = `Usage: agent-memory-js <command> [options]

Commands:
  search <query>            [--corpus thoughts|documents|all] [--limit N] [--mode M] [--value V]
  capture <content>         [--tag t]... | [--tags a,b]
  forget <thought-uuid>
  read-document <doc-id>    [--max-chars N]
  tree list [path] | tree read <path> | tree search <query> [--limit N]
  kv get <key> | kv set <key> <value> [--raw-string] | kv delete <key> | kv list
  tools                     list the server's tool names
  health                    check the server's public /health route
  hook user-prompt          Claude Code UserPromptSubmit hook (reads stdin JSON)
  hook stop                 Claude Code Stop hook (reads stdin JSON)

Connection: --url <mcp-url> --token <bearer> | --stdio --server <stdio.js> [--config <mcp.toml>]
            env: AGENT_MEMORY_URL, AGENT_MEMORY_TOKEN, AGENT_MEMORY_TIMEOUT_MS
Output:     --json --quiet --fail-open --timeout-ms N`;

const { values: flags, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    url: { type: "string" },
    token: { type: "string" },
    stdio: { type: "boolean" },
    server: { type: "string" },
    config: { type: "string" },
    "timeout-ms": { type: "string" },
    json: { type: "boolean" },
    "fail-open": { type: "boolean" },
    quiet: { type: "boolean" },
    corpus: { type: "string" },
    limit: { type: "string" },
    mode: { type: "string" },
    value: { type: "string" },
    tag: { type: "string", multiple: true },
    tags: { type: "string" },
    "max-chars": { type: "string" },
    "raw-string": { type: "boolean" },
    "min-chars": { type: "string" },
    "max-facts": { type: "string" },
    model: { type: "string" },
    help: { type: "boolean" },
  },
});

const out: OutputFlags = { json: flags.json ?? false, failOpen: flags["fail-open"] ?? false, quiet: flags.quiet ?? false };

function num(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new UsageError(`--${name} must be a positive number, got '${raw}'`);
  }
  return n;
}

function need(value: string | undefined, what: string): string {
  if (value === undefined || value === "") {
    throw new UsageError(`Missing ${what}. Run with --help for usage.`);
  }
  return value;
}

function connectOptions(): ConnectOptions {
  const timeoutMs = num("timeout-ms", flags["timeout-ms"]);
  if (flags.stdio) {
    return {
      transport: "stdio",
      serverPath: need(flags.server, "--server <path to stdio.js> for --stdio"),
      ...(flags.config !== undefined ? { configPath: flags.config } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    };
  }
  return {
    ...(flags.url !== undefined ? { url: flags.url } : {}),
    ...(flags.token !== undefined ? { token: flags.token } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

function captureTags(): string[] {
  const tags = [...(flags.tag ?? [])];
  if (flags.tags !== undefined && flags.tags !== "") {
    tags.push(...flags.tags.split(",").map((t) => t.trim()).filter(Boolean));
  }
  return tags;
}

interface CommandResult {
  tool: string;
  data: unknown;
  text?: string;
}

async function withClient(fn: (mem: AgentMemory) => Promise<CommandResult>): Promise<CommandResult> {
  const mem = await AgentMemory.connect(connectOptions());
  try {
    return await fn(mem);
  } finally {
    await mem.close();
  }
}

async function runSearch(query: string): Promise<CommandResult> {
  return withClient(async (mem) => {
    const limit = num("limit", flags.limit);
    const relevanceValue = num("value", flags.value);
    const res = await mem.search(need(query, "search query"), {
      ...(flags.corpus !== undefined ? { corpus: flags.corpus as "thoughts" | "documents" | "all" } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(flags.mode !== undefined
        ? { relevanceMode: flags.mode as "recency_weighted" | "similarity" | "recent" | "since" }
        : {}),
      ...(relevanceValue !== undefined ? { relevanceValue } : {}),
    });
    const data =
      res.corpus === "thoughts"
        ? { corpus: res.corpus, mode: res.mode, results: res.results }
        : { corpus: res.corpus, degraded: res.degraded, hits: res.hits };
    return { tool: "memory_search", data, text: res.text };
  });
}

/** Commands whose default output is the frozen text: fetch it via raw() when
 *  not in --json mode, the typed method otherwise. */
async function runTyped(
  tool: string,
  args: Record<string, unknown>,
  typed: (mem: AgentMemory) => Promise<unknown>,
): Promise<CommandResult> {
  return withClient(async (mem) => {
    if (out.json) {
      return { tool, data: await typed(mem) };
    }
    const reply = await mem.raw(tool, args);
    return { tool, data: reply.structured, text: reply.text };
  });
}

function parseKvValue(raw: string): unknown {
  if (flags["raw-string"]) {
    return raw;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

async function runHealth(): Promise<CommandResult> {
  const base = flags.url ?? process.env["AGENT_MEMORY_URL"] ?? DEFAULT_URL;
  const healthUrl = base.replace(/\/mcp\/?$/, "/health");
  const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) });
  const body = (await response.json()) as Record<string, unknown>;
  return { tool: "health", data: body, text: JSON.stringify(body) };
}

async function dispatch(): Promise<CommandResult> {
  const [command, sub, arg] = positionals;
  switch (command) {
    case "search":
      return runSearch(need(sub, "search query"));
    case "capture": {
      const content = need(sub, "content to capture");
      return runTyped("memory_capture", { content, tags: captureTags() }, (mem) => mem.capture(content, captureTags()));
    }
    case "forget": {
      const id = need(sub, "thought id");
      return runTyped("memory_forget", { thought_id: id }, (mem) => mem.forget(id));
    }
    case "read-document": {
      const id = need(sub, "document id");
      const maxChars = num("max-chars", flags["max-chars"]);
      return runTyped(
        "memory_read_document",
        { document_id: id, ...(maxChars !== undefined ? { max_chars: maxChars } : {}) },
        (mem) => mem.readDocument(id, maxChars !== undefined ? { maxChars } : {}),
      );
    }
    case "tree": {
      switch (sub) {
        case "list":
          return runTyped("memory_tree", { op: "list", ...(arg !== undefined ? { path: arg } : {}) }, (mem) =>
            mem.tree.list(arg),
          );
        case "read": {
          const path = need(arg, "tree path");
          return runTyped("memory_tree", { op: "read", path }, (mem) => mem.tree.read(path));
        }
        case "search": {
          const query = need(arg, "tree search query");
          const limit = num("limit", flags.limit);
          return runTyped(
            "memory_tree",
            { op: "search", query, ...(limit !== undefined ? { limit } : {}) },
            (mem) => mem.tree.search(query, limit !== undefined ? { limit } : {}),
          );
        }
        default:
          throw new UsageError(`Unknown tree op '${sub ?? ""}' (expected list, read, or search).`);
      }
    }
    case "kv": {
      switch (sub) {
        case "get": {
          const key = need(arg, "key");
          return withClient(async (mem) => {
            const reply = await mem.raw("memory_kv_get", { key });
            return { tool: "memory_kv_get", data: reply.structured, text: reply.text };
          });
        }
        case "set": {
          const key = need(arg, "key");
          const rawValue = need(positionals[3], "value");
          return runTyped("memory_kv_set", { key, value: parseKvValue(rawValue) }, async (mem) => {
            await mem.kv.set(key, parseKvValue(rawValue));
            return { key, set: true };
          });
        }
        case "delete": {
          const key = need(arg, "key");
          return runTyped("memory_kv_delete", { key }, async (mem) => ({ key, deleted: await mem.kv.delete(key) }));
        }
        case "list":
          return runTyped("memory_kv_list", {}, (mem) => mem.kv.list());
        default:
          throw new UsageError(`Unknown kv op '${sub ?? ""}' (expected get, set, delete, or list).`);
      }
    }
    case "tools":
      return withClient(async (mem) => {
        const names = await mem.listTools();
        return { tool: "tools", data: names, text: names.join("\n") };
      });
    case "health":
      return runHealth();
    case "hook": {
      const { runHook } = await import("./hook.js");
      return runHook(sub, connectOptions(), {
        limit: num("limit", flags.limit),
        corpus: flags.corpus,
        timeoutMs: num("timeout-ms", flags["timeout-ms"]),
        minChars: num("min-chars", flags["min-chars"]),
        maxFacts: num("max-facts", flags["max-facts"]),
        model: flags.model,
      });
    }
    case undefined:
      throw new UsageError(USAGE);
    default:
      throw new UsageError(`Unknown command '${command}'.\n\n${USAGE}`);
  }
}

if (flags.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

try {
  const result = await dispatch();
  emitOk(out, result.tool, result.data, result.text);
  process.exitCode = 0;
} catch (err) {
  process.exitCode = emitError(out, err);
}
