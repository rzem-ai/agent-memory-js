import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startHttpHarness, type HttpHarness } from "./mock/http.js";

const TOKEN = "test-token";
const CLI_PATH = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));

let harness: HttpHarness;

beforeAll(async () => {
  harness = await startHttpHarness(TOKEN);
});

afterAll(async () => {
  await harness.close();
});

interface CliRun {
  stdout: string;
  stderr: string;
  code: number;
}

function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", CLI_PATH, ...args],
      {
        env: {
          ...process.env,
          AGENT_MEMORY_URL: `${harness.origin}/mcp`,
          AGENT_MEMORY_TOKEN: TOKEN,
          ...env,
        },
      },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === "number" ? error.code : 0;
        resolve({ stdout, stderr, code });
      },
    );
  });
}

function envelope(run: CliRun): Record<string, unknown> {
  return JSON.parse(run.stdout) as Record<string, unknown>;
}

describe("agent-memory-js CLI", { timeout: 30_000 }, () => {
  test("search --json returns the ok envelope with typed hits", async () => {
    const run = await runCli(["search", "pnpm", "--json"]);
    expect(run.code).toBe(0);
    const body = envelope(run);
    expect(body["ok"]).toBe(true);
    expect(body["tool"]).toBe("memory_search");
    const data = body["data"] as { hits: unknown[] };
    expect(data.hits).toHaveLength(2);
    expect(body["text"]).toContain("corpus: all");
  });

  test("search default output is the server's frozen text verbatim", async () => {
    const run = await runCli(["search", "pnpm"]);
    expect(run.code).toBe(0);
    expect(run.stdout.startsWith("corpus: all (thoughts + documents)")).toBe(true);
  });

  test("capture --json returns the structured outcome", async () => {
    const run = await runCli(["capture", "a fresh thought", "--tag", "cli", "--json"]);
    expect(run.code).toBe(0);
    const body = envelope(run);
    expect(body["data"]).toMatchObject({ captured: true });
  });

  test("kv get miss reports found:false", async () => {
    const run = await runCli(["kv", "get", "absent", "--json"]);
    expect(run.code).toBe(0);
    expect(envelope(run)["data"]).toEqual({ key: "absent", found: false });
  });

  test("tools lists the nine names", async () => {
    const run = await runCli(["tools"]);
    expect(run.code).toBe(0);
    expect(run.stdout.trim().split("\n")).toHaveLength(9);
  });

  test("a wrong token exits 4 with an auth error envelope", async () => {
    const run = await runCli(["search", "pnpm", "--json"], { AGENT_MEMORY_TOKEN: "nope" });
    expect(run.code).toBe(4);
    const body = envelope(run);
    expect(body["ok"]).toBe(false);
    expect((body["error"] as { kind: string }).kind).toBe("auth");
  });

  test("a scope denial exits 1 with a tool error envelope", async () => {
    const run = await runCli(["capture", "denied", "--json"]);
    expect(run.code).toBe(1);
    const body = envelope(run);
    expect((body["error"] as { kind: string }).kind).toBe("tool");
  });

  test("--fail-open forces exit 0 on a dead server and keeps the envelope", async () => {
    const run = await runCli(["search", "pnpm", "--json", "--fail-open"], {
      AGENT_MEMORY_URL: "http://127.0.0.1:9/mcp",
    });
    expect(run.code).toBe(0);
    expect(envelope(run)["ok"]).toBe(false);
  });

  test("--fail-open --quiet prints nothing on failure", async () => {
    const run = await runCli(["search", "pnpm", "--fail-open", "--quiet"], {
      AGENT_MEMORY_URL: "http://127.0.0.1:9/mcp",
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toBe("");
  });

  test("an unknown command exits 2", async () => {
    const run = await runCli(["frobnicate"]);
    expect(run.code).toBe(2);
  });
});
