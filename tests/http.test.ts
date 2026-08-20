import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AgentMemory } from "../src/index.js";
import { AuthError, TransportError } from "../src/errors.js";
import { startHttpHarness, type HttpHarness } from "./mock/http.js";

const TOKEN = "test-token";
let harness: HttpHarness;

beforeAll(async () => {
  harness = await startHttpHarness(TOKEN);
});

afterAll(async () => {
  await harness.close();
});

describe("HTTP transport", () => {
  test("connects with a bearer token and lists the nine tools", async () => {
    const mem = await AgentMemory.connect({ url: `${harness.origin}/mcp`, token: TOKEN });
    const tools = await mem.listTools();
    expect(tools).toHaveLength(9);
    expect(tools[0]).toBe("memory_search");
    await mem.close();
  });

  test("tolerates the /memory path prefix", async () => {
    const mem = await AgentMemory.connect({ url: `${harness.origin}/memory/mcp`, token: TOKEN });
    expect(await mem.listTools()).toHaveLength(9);
    await mem.close();
  });

  test("a real call round-trips: search over 'all' parses typed hits", async () => {
    const mem = await AgentMemory.connect({ url: `${harness.origin}/mcp`, token: TOKEN });
    const res = await mem.search("pnpm");
    if (res.corpus === "thoughts") throw new Error("unexpected corpus");
    expect(res.hits).toHaveLength(2);
    await mem.close();
  });

  test("a wrong token surfaces as AuthError", async () => {
    await expect(AgentMemory.connect({ url: `${harness.origin}/mcp`, token: "nope" })).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  test("a missing token surfaces as AuthError", async () => {
    await expect(AgentMemory.connect({ url: `${harness.origin}/mcp` })).rejects.toBeInstanceOf(AuthError);
  });

  test("an unreachable server surfaces as TransportError", async () => {
    await expect(
      AgentMemory.connect({ url: "http://127.0.0.1:9/mcp", token: TOKEN, timeoutMs: 2_000 }),
    ).rejects.toBeInstanceOf(TransportError);
  });

  test("a slow tool call beyond timeoutMs surfaces as TransportError", async () => {
    const mem = await AgentMemory.connect({ url: `${harness.origin}/mcp`, token: TOKEN, timeoutMs: 100 });
    await expect(mem.search("slow")).rejects.toBeInstanceOf(TransportError);
    await mem.close();
  });
});
