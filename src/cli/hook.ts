/**
 * Claude Code hook subcommands. The contract is strict: NEVER exit non-zero
 * (exit 2 on UserPromptSubmit blocks and erases the user's prompt) and never
 * print anything except the intended payload — bare stdout on UserPromptSubmit
 * is injected as context verbatim. Every failure path is silence.
 *
 * - `hook user-prompt`: read the hook stdin JSON, search memory with the
 *   prompt, print {hookSpecificOutput:{additionalContext}} on hits.
 * - `hook stop`: read the transcript tail, distil capture-worthy facts via a
 *   one-shot `claude -p` (overridable with AGENT_MEMORY_DISTILL_CMD), store
 *   them via memory_capture. Progress notes go to stderr only.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { AgentMemory, type SearchResponse } from "../client.js";
import type { ConnectOptions } from "../connect.js";

export interface HookFlags {
  limit?: number | undefined;
  corpus?: string | undefined;
  timeoutMs?: number | undefined;
  minChars?: number | undefined;
  maxFacts?: number | undefined;
  model?: string | undefined;
}

const USER_PROMPT_DEADLINE_MS = 8_000;
const STOP_DEADLINE_MS = 30_000;
const DEFAULT_LIMIT = 4;
const DEFAULT_MIN_CHARS = 12;
const DEFAULT_MAX_FACTS = 3;
const DEFAULT_DISTILL_MODEL = "claude-haiku-4-5-20251001";
const LINE_MAX_CHARS = 300;
const TRANSCRIPT_SIDE_MAX_CHARS = 4_000;

export async function runHook(event: string | undefined, connect: ConnectOptions, flags: HookFlags): Promise<void> {
  try {
    if (event === "user-prompt") {
      await userPromptHook(connect, flags);
    } else if (event === "stop") {
      await stopHook(connect, flags);
    } else {
      process.stderr.write(`agent-memory-js hook: unknown event '${event ?? ""}'\n`);
    }
  } catch {
    // Fail-open by contract: a broken memory server never breaks the session.
  }
}

async function readStdin(): Promise<string> {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data;
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Run fn against a connected client, aborting the whole attempt (connect
 *  included) at the deadline. The loser of the race is abandoned; the process
 *  exits right after, so nothing leaks. */
async function withDeadline<T>(connect: ConnectOptions, deadlineMs: number, fn: (mem: AgentMemory) => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("hook deadline exceeded")), deadlineMs);
  });
  const run = (async () => {
    const mem = await AgentMemory.connect({ ...connect, timeoutMs: deadlineMs });
    try {
      return await fn(mem);
    } finally {
      mem.close().catch(() => undefined);
    }
  })();
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function truncate(line: string, max: number = LINE_MAX_CHARS): string {
  const collapsed = line.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function contextLines(res: SearchResponse): string[] {
  if (res.corpus === "thoughts") {
    return res.results.map((row) =>
      truncate(
        `- (thought ${row.created_at.slice(0, 10)}) ${row.content}${row.tags.length ? ` [tags: ${row.tags.join(", ")}]` : ""}`,
      ),
    );
  }
  return res.hits.map((hit) =>
    hit.corpus === "thoughts"
      ? truncate(`- (thought ${hit.date}) ${hit.content}${hit.tags.length ? ` [tags: ${hit.tags.join(", ")}]` : ""}`)
      : truncate(`- (${hit.sourceKind} doc ${hit.date}, id: ${hit.documentId}) ${hit.snippet}`),
  );
}

async function userPromptHook(connect: ConnectOptions, flags: HookFlags): Promise<void> {
  const input = parseJson(await readStdin());
  const prompt = input?.["prompt"] ?? input?.["user_prompt"];
  if (typeof prompt !== "string") {
    return;
  }
  const trimmed = prompt.trim();
  if (trimmed.length < (flags.minChars ?? DEFAULT_MIN_CHARS) || trimmed.startsWith("/")) {
    return;
  }
  const res = await withDeadline(connect, flags.timeoutMs ?? USER_PROMPT_DEADLINE_MS, (mem) =>
    mem.search(trimmed, {
      corpus: (flags.corpus as "thoughts" | "documents" | "all" | undefined) ?? "all",
      limit: flags.limit ?? DEFAULT_LIMIT,
    }),
  );
  const lines = contextLines(res);
  if (lines.length === 0) {
    return;
  }
  const additionalContext = `Relevant long-term memory (agent-memory):\n${lines.join("\n")}`;
  process.stdout.write(
    `${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } })}\n`,
  );
}

interface TranscriptEntry {
  type?: string;
  message?: { content?: unknown };
}

function entryText(entry: TranscriptEntry): string {
  const content = entry.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: string; text: string } => {
        if (typeof block !== "object" || block === null) return false;
        const b = block as Record<string, unknown>;
        return b["type"] === "text" && typeof b["text"] === "string";
      })
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

async function transcriptTail(path: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const entries = raw
    .split("\n")
    .filter(Boolean)
    .map(parseJson)
    .filter((entry): entry is Record<string, unknown> => entry !== null) as TranscriptEntry[];
  const lastOfType = (type: string): string =>
    entries
      .filter((entry) => entry.type === type)
      .map(entryText)
      .filter(Boolean)
      .at(-1) ?? "";
  const user = lastOfType("user").slice(-TRANSCRIPT_SIDE_MAX_CHARS);
  const assistant = lastOfType("assistant").slice(-TRANSCRIPT_SIDE_MAX_CHARS);
  if (!user && !assistant) {
    return null;
  }
  return `User:\n${user}\n\nAssistant:\n${assistant}`;
}

function distill(excerpt: string, maxFacts: number, model: string, timeoutMs: number): Promise<string[]> {
  const override = process.env["AGENT_MEMORY_DISTILL_CMD"];
  const instruction =
    `Extract up to ${maxFacts} durable facts worth remembering long-term from this conversation excerpt: ` +
    `stable preferences, decisions, and project facts - never transient task detail. ` +
    `Output ONLY a JSON array of short self-contained strings, or NONE if nothing is worth keeping.`;
  const [cmd, ...args] = override ? override.split(" ") : ["claude", "-p", instruction, "--model", model];
  return new Promise((resolve) => {
    const child = execFile(cmd!, args, { timeout: timeoutMs }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      const start = stdout.indexOf("[");
      const end = stdout.lastIndexOf("]");
      if (start === -1 || end <= start) {
        resolve([]);
        return;
      }
      try {
        const parsed: unknown = JSON.parse(stdout.slice(start, end + 1));
        resolve(Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === "string" && f.trim() !== "") : []);
      } catch {
        resolve([]);
      }
    });
    child.stdin?.end(excerpt);
  });
}

async function stopHook(connect: ConnectOptions, flags: HookFlags): Promise<void> {
  const input = parseJson(await readStdin());
  if (!input || input["stop_hook_active"] === true) {
    return;
  }
  const path = input["transcript_path"];
  if (typeof path !== "string") {
    return;
  }
  const excerpt = await transcriptTail(path);
  if (!excerpt) {
    return;
  }
  const deadlineMs = flags.timeoutMs ?? STOP_DEADLINE_MS;
  const maxFacts = flags.maxFacts ?? DEFAULT_MAX_FACTS;
  const facts = await distill(excerpt, maxFacts, flags.model ?? DEFAULT_DISTILL_MODEL, deadlineMs);
  if (facts.length === 0) {
    return;
  }
  const cwd = typeof input["cwd"] === "string" ? input["cwd"] : process.cwd();
  const tags = ["claude-code", `project:${basename(cwd)}`, "auto-captured"];
  const captured = await withDeadline(connect, deadlineMs, async (mem) => {
    let count = 0;
    for (const fact of facts.slice(0, maxFacts)) {
      const outcome = await mem.capture(fact, tags);
      if (outcome.captured) {
        count += 1;
      }
    }
    return count;
  });
  process.stderr.write(`agent-memory-js hook stop: captured ${captured} fact(s)\n`);
}
