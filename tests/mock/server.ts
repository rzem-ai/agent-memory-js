/**
 * A mock agent-memory server for round-trip tests: the same nine tools, the
 * same input schemas, the same frozen text + structuredContent shapes as the
 * real server (mirrored from its src/tools/*), with canned recall results and
 * a live in-memory KV store. Input sentinels steer the error paths:
 *
 * - search query "none" -> empty sentinel; "degraded" -> degraded note suffix;
 *   corpus "documents" + query "degraded" -> note-only isError result.
 * - capture content "dup" -> dedup skip; "denied" -> scope-denial error.
 * - forget/read/tree misses via the KNOWN_* ids below.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/server";
import type { Transport } from "@modelcontextprotocol/client";
import { DOCUMENTS_UNAVAILABLE_NOTE } from "../../src/types.js";
import { fixture } from "../parse/helpers.js";

export const KNOWN_THOUGHT_ID = "3f2a8c1e-5b7d-4e9a-8c3d-1a2b3c4d5e6f";
export const KNOWN_DOCUMENT_ID = "mail-2026-07-15-0042";
export const KNOWN_TREE_PATH = "mail/2026/07";
export const CAPTURED_ID = "0b0b0b0b-1111-2222-3333-444444444444";
export const DUPLICATE_OF_ID = "9e9e9e9e-8888-7777-6666-555555555555";

const RANKED_THOUGHT = {
  id: KNOWN_THOUGHT_ID,
  agent_id: "angus",
  content: "Alex prefers pnpm for the angus2 workspace",
  tags: ["claude-code", "project:angus2"],
  similarity: 0.903,
  score: 0.812,
  created_at: "2026-08-01T09:00:00.000Z",
};

interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

function textResult(text: string, structured?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], structuredContent: structured ?? { text } };
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], structuredContent: { error: text }, isError: true };
}

const AnyOutput = z.record(z.string(), z.unknown());

export function createMockServer(): { server: McpServer; connect: (transport: Transport) => Promise<void> } {
  const server = new McpServer({ name: "agent-memory", version: "0.0.0-mock" });
  const kv = new Map<string, unknown>();

  const tool = (
    name: string,
    inputSchema: Record<string, z.ZodType>,
    handler: (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>,
  ): void => {
    server.registerTool(
      name,
      { description: `mock ${name}`, inputSchema, outputSchema: AnyOutput },
      (args: Record<string, unknown>) => handler(args),
    );
  };

  tool(
    "memory_search",
    ({
      query: z.string().min(1),
      corpus: z.enum(["thoughts", "documents", "all"]).optional(),
      limit: z.number().int().positive().optional(),
      relevance_mode: z.enum(["recency_weighted", "similarity", "recent", "since"]).optional(),
      relevance_value: z.number().positive().optional(),
    }),
    async (args) => {
      const corpus = (args["corpus"] as string | undefined) ?? "all";
      const query = args["query"] as string;
      if (query === "slow") {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (query === "denied") {
        return errorResult(
          "Insufficient scope: 'memory_search' requires 'memory:read' (caller 'nobody' has: none).",
        );
      }
      if (corpus === "thoughts") {
        const results = query === "none" ? [] : [RANKED_THOUGHT];
        const text =
          results.length === 0
            ? "No matching memories found."
            : `mode: recency_weighted\n\n[1] (id: ${RANKED_THOUGHT.id}, score: 0.812, sim: 0.903, 2026-08-01) [angus] ${RANKED_THOUGHT.content} | tags: claude-code, project:angus2`;
        return textResult(text, { mode: "recency_weighted", count: results.length, results });
      }
      if (query === "degraded") {
        return corpus === "documents"
          ? errorResult(DOCUMENTS_UNAVAILABLE_NOTE)
          : textResult(fixture("merged-all-degraded.txt"));
      }
      if (query === "none") {
        return textResult("No matching memories found.");
      }
      return textResult(fixture(corpus === "documents" ? "merged-documents.txt" : "merged-all.txt"));
    },
  );

  tool("memory_capture", ({ content: z.string().min(1), tags: z.array(z.string()) }), (args) => {
    const content = args["content"] as string;
    if (content === "denied") {
      return errorResult(
        "Insufficient scope: 'memory_capture' requires 'memory:write' (caller 'reader' has: memory:read).",
      );
    }
    if (content === "dup") {
      return textResult(
        `Memory skipped - near-duplicate of an existing thought (id: ${DUPLICATE_OF_ID}, cosine >= 0.85 within 48h).`,
        { id: null, skipped: true, duplicate_of: DUPLICATE_OF_ID },
      );
    }
    if (content === "supersede") {
      return textResult(`Memory captured successfully (id: ${CAPTURED_ID}, superseded 2 stale thoughts)`, {
        id: CAPTURED_ID,
        skipped: false,
        superseded: 2,
      });
    }
    return textResult(`Memory captured successfully (id: ${CAPTURED_ID})`, {
      id: CAPTURED_ID,
      skipped: false,
      superseded: 0,
    });
  });

  tool("memory_forget", ({ thought_id: z.string().uuid() }), (args) => {
    const id = args["thought_id"] as string;
    const forgotten = id === KNOWN_THOUGHT_ID;
    return textResult(
      forgotten ? `Forgot thought ${id}` : `Thought ${id} not found or already deleted`,
      { thought_id: id, forgotten },
    );
  });

  tool(
    "memory_read_document",
    ({ document_id: z.string().min(1), max_chars: z.number().int().positive().optional() }),
    (args) => {
      const id = args["document_id"] as string;
      if (id === KNOWN_DOCUMENT_ID) {
        return textResult(fixture("document-full.txt"), {
          document_id: id,
          found: true,
          taint: "external",
          body_source: "vault",
          truncated: false,
        });
      }
      return textResult(`No document with id '${id}'.`, { document_id: id, found: false });
    },
  );

  tool(
    "memory_tree",
    ({
      op: z.enum(["list", "read", "search"]),
      path: z.string().optional(),
      query: z.string().optional(),
      limit: z.number().int().positive().optional(),
    }),
    (args) => {
      const op = args["op"] as string;
      if (op === "list") {
        return textResult(fixture("tree-list-roots.txt"), { op: "list", count: 2 });
      }
      if (op === "read") {
        const path = args["path"] as string | undefined;
        if (!path?.trim()) {
          return errorResult("Error: 'path' is required for op 'read'.");
        }
        if (path === KNOWN_TREE_PATH) {
          return textResult(fixture("tree-node-summarised.txt"), { op: "read", path, state: "summarised" });
        }
        return textResult(`No tree node at path '${path}'.`, { op: "read", path, found: false });
      }
      return textResult(fixture("tree-search.txt"), { op: "search", count: 2 });
    },
  );

  tool("memory_kv_get", ({ key: z.string().min(1) }), (args) => {
    const key = args["key"] as string;
    const value = kv.has(key) ? kv.get(key) : null;
    // Mirrors the real server: a stored null is indistinguishable from a miss.
    return value === null
      ? textResult(`No value found for key '${key}'`, { key, found: false })
      : textResult(JSON.stringify(value, null, 2), { key, found: true, value });
  });

  tool("memory_kv_set", ({ key: z.string().min(1), value: z.unknown() }), (args) => {
    const key = args["key"] as string;
    kv.set(key, args["value"] ?? null);
    return textResult(`Set '${key}'`, { key, set: true });
  });

  tool("memory_kv_delete", ({ key: z.string().min(1) }), (args) => {
    const key = args["key"] as string;
    const deleted = kv.delete(key);
    return textResult(deleted ? `Deleted '${key}'` : `Key '${key}' not found`, { key, deleted });
  });

  tool("memory_kv_list", ({}), () => {
    const entries = Object.fromEntries(kv.entries());
    const keys = Object.keys(entries);
    if (keys.length === 0) {
      return textResult("No KV entries", { count: 0, entries: {} });
    }
    return textResult(keys.map((k) => `${k}: ${JSON.stringify(entries[k])}`).join("\n"), {
      count: keys.length,
      entries,
    });
  });

  return { server, connect: (transport) => server.connect(transport) };
}
