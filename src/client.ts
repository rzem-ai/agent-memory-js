/**
 * AgentMemory — the typed client over the agent-memory MCP server's nine
 * tools. Trusts structuredContent where the server sends real structure
 * (thoughts search, capture, forget, kv) and parses the frozen text where it
 * does not (merged search, tree, document read). Misses are values, never
 * throws; `isError` tool results become ToolError; transport failures become
 * TransportError/AuthError.
 */

import type { CallToolResult, Client } from "@modelcontextprotocol/client";
import { SdkHttpError, UnauthorizedError } from "@modelcontextprotocol/client";
import type { ConnectOptions } from "./connect.js";
import { buildClient, buildTransport, resolveTimeoutMs } from "./connect.js";
import { AuthError, ToolError, TransportError } from "./errors.js";
import { parseDocument, parseMergedResults, parseTreeList, parseTreeNode, parseTreeSearch } from "./parse/index.js";
import type {
  Corpus,
  MergedHit,
  ParsedDocument,
  ParsedTreeList,
  ParsedTreeNode,
  ParsedTreeSearch,
  RankedThought,
  RelevanceMode,
} from "./types.js";

export type SearchResponse =
  | { corpus: "thoughts"; mode: RelevanceMode; results: RankedThought[]; text: string }
  | { corpus: "documents" | "all"; hits: MergedHit[]; degraded: boolean; text: string };

export type CaptureOutcome =
  | { captured: true; id: string; superseded: number }
  | { captured: false; duplicateOf: string };

export interface SearchOptions {
  corpus?: Corpus;
  limit?: number;
  relevanceMode?: RelevanceMode;
  relevanceValue?: number;
}

interface ToolReply {
  text: string;
  structured: Record<string, unknown>;
}

function toTransportError(err: unknown): TransportError {
  if (err instanceof UnauthorizedError || (err instanceof SdkHttpError && err.status === 401)) {
    const wrapped = new AuthError(`Authentication failed: ${err.message}`);
    wrapped.cause = err;
    return wrapped;
  }
  const wrapped = new TransportError(err instanceof Error ? err.message : String(err));
  wrapped.cause = err;
  return wrapped;
}

export class AgentMemory {
  readonly tree: {
    list(path?: string): Promise<ParsedTreeList>;
    read(path: string): Promise<ParsedTreeNode | null>;
    search(query: string, opts?: { limit?: number }): Promise<ParsedTreeSearch>;
  };

  readonly kv: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
    list(): Promise<Record<string, unknown>>;
  };

  private constructor(
    private readonly client: Client,
    private readonly timeoutMs: number,
  ) {
    this.tree = {
      list: async (path) => parseTreeList((await this.call("memory_tree", { op: "list", ...(path !== undefined ? { path } : {}) })).text),
      read: async (path) => {
        const reply = await this.call("memory_tree", { op: "read", path });
        return reply.structured["found"] === false ? null : parseTreeNode(reply.text);
      },
      search: async (query, opts) =>
        parseTreeSearch(
          (await this.call("memory_tree", { op: "search", query, ...(opts?.limit !== undefined ? { limit: opts.limit } : {}) })).text,
        ),
    };
    this.kv = {
      get: async (key) => {
        const reply = await this.call("memory_kv_get", { key });
        return reply.structured["found"] === false ? undefined : reply.structured["value"];
      },
      set: async (key, value) => {
        await this.call("memory_kv_set", { key, value });
      },
      delete: async (key) => (await this.call("memory_kv_delete", { key })).structured["deleted"] === true,
      list: async () => {
        const reply = await this.call("memory_kv_list", {});
        return (reply.structured["entries"] ?? {}) as Record<string, unknown>;
      },
    };
  }

  static async connect(options: ConnectOptions = {}): Promise<AgentMemory> {
    const client = buildClient(options);
    const transport = await buildTransport(options);
    try {
      await client.connect(transport);
    } catch (err) {
      throw toTransportError(err);
    }
    return new AgentMemory(client, resolveTimeoutMs(options));
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  /** The nine tool names as the server lists them — a connectivity check. */
  async listTools(): Promise<string[]> {
    try {
      const result = await this.client.listTools(undefined, { timeout: this.timeoutMs });
      return result.tools.map((tool) => tool.name);
    } catch (err) {
      throw toTransportError(err);
    }
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResponse> {
    const corpus: Corpus = opts.corpus ?? "all";
    const reply = await this.call("memory_search", {
      query,
      corpus,
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      ...(opts.relevanceMode !== undefined ? { relevance_mode: opts.relevanceMode } : {}),
      ...(opts.relevanceValue !== undefined ? { relevance_value: opts.relevanceValue } : {}),
    });
    if (corpus === "thoughts") {
      return {
        corpus,
        mode: reply.structured["mode"] as RelevanceMode,
        results: (reply.structured["results"] ?? []) as RankedThought[],
        text: reply.text,
      };
    }
    const parsed = parseMergedResults(reply.text);
    return { corpus, hits: parsed.hits, degraded: parsed.degraded, text: reply.text };
  }

  async capture(content: string, tags: string[] = []): Promise<CaptureOutcome> {
    const reply = await this.call("memory_capture", { content, tags });
    if (reply.structured["skipped"] === true) {
      return { captured: false, duplicateOf: reply.structured["duplicate_of"] as string };
    }
    return {
      captured: true,
      id: reply.structured["id"] as string,
      superseded: (reply.structured["superseded"] as number | undefined) ?? 0,
    };
  }

  async forget(thoughtId: string): Promise<{ forgotten: boolean }> {
    const reply = await this.call("memory_forget", { thought_id: thoughtId });
    return { forgotten: reply.structured["forgotten"] === true };
  }

  async readDocument(documentId: string, opts: { maxChars?: number } = {}): Promise<ParsedDocument | null> {
    const reply = await this.call("memory_read_document", {
      document_id: documentId,
      ...(opts.maxChars !== undefined ? { max_chars: opts.maxChars } : {}),
    });
    return reply.structured["found"] === false ? null : parseDocument(reply.text);
  }

  /** Low-level escape hatch: one tools/call, returning the frozen text and
   *  structuredContent as the server sent them. */
  async raw(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; structured: Record<string, unknown> }> {
    return this.call(name, args);
  }

  private async call(name: string, args: Record<string, unknown>): Promise<ToolReply> {
    let result: CallToolResult;
    try {
      result = await this.client.callTool({ name, arguments: args }, { timeout: this.timeoutMs });
    } catch (err) {
      throw toTransportError(err);
    }
    const text = result.content.find((block) => block.type === "text")?.text ?? "";
    if (result.isError) {
      throw new ToolError(name, text);
    }
    return { text, structured: (result.structuredContent ?? {}) as Record<string, unknown> };
  }
}
