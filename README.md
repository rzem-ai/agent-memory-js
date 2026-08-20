# @rzem-ai/agent-memory-js

Typed JavaScript client, CLI, and Claude Code plugin for the
[agent-memory](https://github.com/rzem-ai/agent-memory) MCP server.

The server exposes nine tools over MCP (semantic recall across a thoughts
corpus and a synced document vault, a tree of LLM-summarised digests, and a
KV store). This package wraps them in typed methods, parses the server's
frozen text formats back into structured objects, and ships the hooks that
give Claude Code sessions automatic long-term memory.

- **No `agent_id` anywhere** — the credential carries the namespace.
- **Fail-open by design** — a down memory server is "no memory this turn",
  never a broken session. Hooks always exit 0.
- **Frozen-text aware** — `memory_search` (documents/all), `memory_tree`, and
  `memory_read_document` return their payloads only as text in a frozen
  format; the parsers here mirror the server's formatters exactly.

## Library

```js
import { AgentMemory } from "@rzem-ai/agent-memory-js";

const mem = await AgentMemory.connect({
  url: "http://127.0.0.1:3010/mcp",        // default; env AGENT_MEMORY_URL
  token: process.env.AGENT_MEMORY_TOKEN,    // env AGENT_MEMORY_TOKEN
  timeoutMs: 120_000,                       // generous: cold Ollama embeds
});

const res = await mem.search("badgers", { corpus: "all", limit: 5 });
// res.hits: typed ThoughtHit | DocumentHit rows; res.degraded; res.text (raw)

await mem.capture("Alex prefers pnpm for the angus2 workspace", ["claude-code"]);
await mem.forget(thoughtId);                 // { forgotten: boolean }
await mem.readDocument(docId);               // ParsedDocument | null
await mem.tree.list("mail/2026");            // { scope, entries }
await mem.kv.set("key", { any: "json" });
await mem.kv.get("key");                     // undefined on miss
await mem.close();
```

Stdio (no auth; identity from the server's TOML):

```js
const mem = await AgentMemory.connect({
  transport: "stdio",
  serverPath: "/path/to/agent-memory/dist/stdio.js",
  configPath: "/path/to/mcp.toml",
});
```

Errors: `AuthError` (HTTP 401) and `TransportError` (network/timeout) at the
transport layer; `ToolError` with `kind` (`scope_denied | validation |
no_namespace | degraded | failed`) for `isError` tool results; `ParseError`
when the frozen text drifts. Misses are values, not throws: `forget` →
`{forgotten:false}`, `kv.get` → `undefined`, `readDocument`/`tree.read` →
`null`. Note the server-side quirk: a stored KV `null` is indistinguishable
from a missing key.

## CLI

```
agent-memory-js search "badgers" [--corpus all|thoughts|documents] [--limit 5] [--json]
agent-memory-js capture "content" --tag claude-code --tag project:x
agent-memory-js forget <uuid>
agent-memory-js read-document <doc-id> [--max-chars 20000]
agent-memory-js tree list [path] | tree read <path> | tree search "query"
agent-memory-js kv get|set|delete|list ...
agent-memory-js tools | health
```

Config via `AGENT_MEMORY_URL` / `AGENT_MEMORY_TOKEN` / `AGENT_MEMORY_TIMEOUT_MS`
or `--url` / `--token` / `--timeout-ms`. Default output is the server's frozen
text verbatim; `--json` emits one machine envelope
(`{"ok":true,"tool","data","text"}` or `{"ok":false,"error":{kind,message}}`).
Exit codes: `0` ok, `1` tool/parse, `2` usage, `3` transport, `4` auth.
`--fail-open` forces exit 0 whatever happened; `--quiet` silences output.

## Claude Code plugin

The `plugin/` directory is a Claude Code plugin providing:

- **`.mcp.json`** registering the server over HTTP — sessions get the
  `mcp__agent-memory__*` tools directly.
- **Auto-recall**: a UserPromptSubmit hook searches memory with each prompt
  and injects hits as "Relevant long-term memory" (8s deadline, silent on
  miss or cold server).
- **Auto-capture**: a Stop hook distils durable facts from the finished turn
  via a one-shot `claude -p` (haiku) and captures them, tagged
  `auto-captured`. Server-side dedup absorbs repeats.
- **`using-memory` skill** teaching when to capture/search and the
  taint-external rule.

Install from this repo:

```
claude plugin marketplace add /path/to/agent-memory.js   # or the git URL
claude plugin install agent-memory@agent-memory
```

Set `AGENT_MEMORY_URL` and `AGENT_MEMORY_TOKEN` in the environment Claude
Code runs in. The hooks resolve the CLI via `$AGENT_MEMORY_CLI`, then `PATH`,
then `npx -y @rzem-ai/agent-memory-js` (slow first run).

Already registered agent-memory at user scope? Remove one of the two entries
— the plugin's `.mcp.json` is meant to be the single source.

## Development

```
npm run check        # lint + typecheck + test + build (the gate)
npm run test:live    # env-gated live suite: AGENT_MEMORY_LIVE=1 + URL + TOKEN
```

The parsers in `src/parse/` mirror the server's `src/domain/recall.ts`
formatters — a frozen cross-consumer contract. Change them only in lockstep
with the server. First calls against a cold server can take tens of seconds
(Ollama model load); keep client timeouts generous and consumers fail-open.
