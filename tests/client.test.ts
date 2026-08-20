import { afterEach, describe, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { AgentMemory } from "../src/index.js";
import { ToolError } from "../src/errors.js";
import {
  CAPTURED_ID,
  DUPLICATE_OF_ID,
  KNOWN_DOCUMENT_ID,
  KNOWN_THOUGHT_ID,
  KNOWN_TREE_PATH,
  createMockServer,
} from "./mock/server.js";

const open: AgentMemory[] = [];

async function connectToMock(): Promise<AgentMemory> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createMockServer().connect(serverTransport);
  const mem = await AgentMemory.connect({ transport: "custom", instance: clientTransport });
  open.push(mem);
  return mem;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((mem) => mem.close()));
});

describe("AgentMemory", () => {
  test("listTools reports the nine tool names in registration order", async () => {
    const mem = await connectToMock();
    expect(await mem.listTools()).toEqual([
      "memory_search",
      "memory_capture",
      "memory_forget",
      "memory_read_document",
      "memory_tree",
      "memory_kv_get",
      "memory_kv_set",
      "memory_kv_delete",
      "memory_kv_list",
    ]);
  });

  test("search over thoughts returns the structured rows verbatim", async () => {
    const mem = await connectToMock();
    const res = await mem.search("pnpm", { corpus: "thoughts" });
    expect(res.corpus).toBe("thoughts");
    if (res.corpus !== "thoughts") return;
    expect(res.mode).toBe("recency_weighted");
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toMatchObject({ id: KNOWN_THOUGHT_ID, agent_id: "angus", score: 0.812 });
    expect(res.text).toContain("mode: recency_weighted");
  });

  test("search over 'all' parses the frozen text into typed hits", async () => {
    const mem = await connectToMock();
    const res = await mem.search("pnpm");
    expect(res.corpus).toBe("all");
    if (res.corpus === "thoughts") return;
    expect(res.degraded).toBe(false);
    expect(res.hits).toHaveLength(2);
    expect(res.hits[0]).toMatchObject({ corpus: "thoughts", id: KNOWN_THOUGHT_ID });
    expect(res.hits[1]).toMatchObject({ corpus: "documents", documentId: KNOWN_DOCUMENT_ID });
    expect(res.text.startsWith("corpus: all")).toBe(true);
  });

  test("search reports degradation without throwing for corpus 'all'", async () => {
    const mem = await connectToMock();
    const res = await mem.search("degraded");
    if (res.corpus === "thoughts") return;
    expect(res.degraded).toBe(true);
    expect(res.hits).toHaveLength(1);
  });

  test("a degraded empty 'documents' search throws a ToolError of kind degraded", async () => {
    const mem = await connectToMock();
    await expect(mem.search("degraded", { corpus: "documents" })).rejects.toSatisfy(
      (err) => err instanceof ToolError && err.kind === "degraded",
    );
  });

  test("a scope denial surfaces as ToolError kind scope_denied", async () => {
    const mem = await connectToMock();
    await expect(mem.capture("denied", [])).rejects.toSatisfy(
      (err) => err instanceof ToolError && err.kind === "scope_denied" && err.tool === "memory_capture",
    );
  });

  test("capture returns the structured outcome", async () => {
    const mem = await connectToMock();
    expect(await mem.capture("a fresh thought", ["tag"])).toEqual({
      captured: true,
      id: CAPTURED_ID,
      superseded: 0,
    });
    expect(await mem.capture("supersede", [])).toEqual({ captured: true, id: CAPTURED_ID, superseded: 2 });
    expect(await mem.capture("dup", [])).toEqual({ captured: false, duplicateOf: DUPLICATE_OF_ID });
  });

  test("forget returns the structured flag for hit and miss", async () => {
    const mem = await connectToMock();
    expect(await mem.forget(KNOWN_THOUGHT_ID)).toEqual({ forgotten: true });
    expect(await mem.forget("00000000-0000-0000-0000-000000000000")).toEqual({ forgotten: false });
  });

  test("readDocument parses the frozen document text; a miss is null", async () => {
    const mem = await connectToMock();
    const doc = await mem.readDocument(KNOWN_DOCUMENT_ID);
    expect(doc).toMatchObject({
      id: KNOWN_DOCUMENT_ID,
      title: "Project kickoff notes",
      taint: "external",
      bodySource: "vault",
    });
    expect(await mem.readDocument("nope")).toBeNull();
  });

  test("tree list/read/search parse the frozen formats; a read miss is null", async () => {
    const mem = await connectToMock();
    const list = await mem.tree.list();
    expect(list.scope).toBe("roots");
    expect(list.entries).toHaveLength(2);

    const node = await mem.tree.read(KNOWN_TREE_PATH);
    expect(node).toMatchObject({ path: KNOWN_TREE_PATH, state: "summarised" });
    expect(await mem.tree.read("missing/2031")).toBeNull();

    const search = await mem.tree.search("kickoff planning");
    expect(search.query).toBe("kickoff planning");
    expect(search.results).toHaveLength(2);
  });

  test("kv round-trip: set, get, list, delete; a miss is undefined", async () => {
    const mem = await connectToMock();
    expect(await mem.kv.get("absent")).toBeUndefined();
    await mem.kv.set("config", { theme: "dark", n: 2 });
    expect(await mem.kv.get("config")).toEqual({ theme: "dark", n: 2 });
    expect(await mem.kv.list()).toEqual({ config: { theme: "dark", n: 2 } });
    expect(await mem.kv.delete("config")).toBe(true);
    expect(await mem.kv.delete("config")).toBe(false);
    expect(await mem.kv.list()).toEqual({});
  });

  test("kv stored null is indistinguishable from a miss (server quirk, mirrored)", async () => {
    const mem = await connectToMock();
    await mem.kv.set("nullish", null);
    expect(await mem.kv.get("nullish")).toBeUndefined();
  });
});
