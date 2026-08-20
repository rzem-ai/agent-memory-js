/**
 * Live integration suite against a real agent-memory server. Opt-in:
 *
 *   AGENT_MEMORY_LIVE=1 AGENT_MEMORY_URL=... AGENT_MEMORY_TOKEN=... npm run test:live
 *
 * Non-destructive by design: KV uses a namespaced test key, capture forgets
 * its own row. Generous timeouts — a cold Ollama embed can take tens of
 * seconds on the first call.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AgentMemory } from "../src/index.js";

const LIVE = process.env["AGENT_MEMORY_LIVE"] === "1";
const TEST_KEY = "agent-memory-js:live-test";

describe.skipIf(!LIVE)("live server", { timeout: 180_000 }, () => {
  let mem: AgentMemory;

  beforeAll(async () => {
    mem = await AgentMemory.connect({ timeoutMs: 180_000 });
  });

  afterAll(async () => {
    await mem?.close();
  });

  test("lists the nine tools", async () => {
    expect(await mem.listTools()).toHaveLength(9);
  });

  test("kv round-trip with a namespaced key", async () => {
    await mem.kv.set(TEST_KEY, { stamp: "live-test", n: 1 });
    expect(await mem.kv.get(TEST_KEY)).toEqual({ stamp: "live-test", n: 1 });
    expect(await mem.kv.delete(TEST_KEY)).toBe(true);
    expect(await mem.kv.get(TEST_KEY)).toBeUndefined();
  });

  test("search over thoughts returns structured rows", async () => {
    const res = await mem.search("memory client", { corpus: "thoughts", limit: 3 });
    expect(res.corpus).toBe("thoughts");
    if (res.corpus !== "thoughts") return;
    expect(Array.isArray(res.results)).toBe(true);
    for (const row of res.results) {
      expect(typeof row.id).toBe("string");
      expect(typeof row.similarity).toBe("number");
    }
  });

  test("search over 'all' parses the live frozen text", async () => {
    const res = await mem.search("memory client", { corpus: "all", limit: 3 });
    expect(res.corpus).toBe("all");
    if (res.corpus === "thoughts") return;
    // The parse itself is the assertion: drift in the frozen text throws.
    expect(Array.isArray(res.hits)).toBe(true);
    expect(typeof res.degraded).toBe("boolean");
  });

  test("capture then forget our own row", async () => {
    const outcome = await mem.capture(
      `agent-memory-js live-test marker ${TEST_KEY} - safe to forget`,
      ["agent-memory-js", "live-test"],
    );
    // A dedup skip (from an earlier run inside 48h) is a valid success too.
    const id = outcome.captured ? outcome.id : outcome.duplicateOf;
    expect(typeof id).toBe("string");
    const { forgotten } = await mem.forget(id);
    expect(typeof forgotten).toBe("boolean");
  });
});
