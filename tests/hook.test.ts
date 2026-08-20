import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startHttpHarness, type HttpHarness } from "./mock/http.js";

const CLI_PATH = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));
const FAKE_DISTILL = fileURLToPath(new URL("./mock/fake-distill.mjs", import.meta.url));
const TOKEN = "test-token";

let harness: HttpHarness;
let transcriptPath: string;

const TRANSCRIPT_LINES = [
  JSON.stringify({ type: "user", message: { role: "user", content: "How should I package the memory client?" } }),
  JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Ship it as @rzem-ai/agent-memory-js with a bundled Claude Code plugin." }],
    },
  }),
];

beforeAll(async () => {
  harness = await startHttpHarness(TOKEN);
  const dir = await mkdtemp(join(tmpdir(), "agent-memory-hook-"));
  transcriptPath = join(dir, "transcript.jsonl");
  await writeFile(transcriptPath, `${TRANSCRIPT_LINES.join("\n")}\n`);
});

afterAll(async () => {
  await harness.close();
});

interface HookRun {
  stdout: string;
  stderr: string;
  code: number;
}

function runHook(event: string, stdin: string, env: Record<string, string> = {}): Promise<HookRun> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      ["--import", "tsx", CLI_PATH, "hook", event],
      {
        env: {
          ...process.env,
          AGENT_MEMORY_URL: `${harness.origin}/mcp`,
          AGENT_MEMORY_TOKEN: TOKEN,
          AGENT_MEMORY_DISTILL_CMD: `${process.execPath} ${FAKE_DISTILL}`,
          ...env,
        },
      },
      (error, stdout, stderr) => {
        resolve({ stdout, stderr, code: error && typeof error.code === "number" ? error.code : 0 });
      },
    );
    child.stdin?.end(stdin);
  });
}

describe("hook user-prompt", { timeout: 30_000 }, () => {
  test("injects additionalContext built from search hits", async () => {
    const run = await runHook("user-prompt", JSON.stringify({ prompt: "what package manager does alex prefer?" }));
    expect(run.code).toBe(0);
    const body = JSON.parse(run.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(body.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(body.hookSpecificOutput.additionalContext).toContain("Relevant long-term memory");
    expect(body.hookSpecificOutput.additionalContext).toContain("pnpm");
  });

  test("stays silent on a short prompt", async () => {
    const run = await runHook("user-prompt", JSON.stringify({ prompt: "hi" }));
    expect(run.code).toBe(0);
    expect(run.stdout).toBe("");
  });

  test("stays silent on a slash command", async () => {
    const run = await runHook("user-prompt", JSON.stringify({ prompt: "/compact please and thank you" }));
    expect(run.code).toBe(0);
    expect(run.stdout).toBe("");
  });

  test("stays silent (exit 0) when the server is down", async () => {
    const run = await runHook("user-prompt", JSON.stringify({ prompt: "what package manager does alex prefer?" }), {
      AGENT_MEMORY_URL: "http://127.0.0.1:9/mcp",
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toBe("");
  });

  test("stays silent on unparseable stdin", async () => {
    const run = await runHook("user-prompt", "not json at all");
    expect(run.code).toBe(0);
    expect(run.stdout).toBe("");
  });
});

describe("hook stop", { timeout: 30_000 }, () => {
  test("distils the transcript tail and captures the facts", async () => {
    const run = await runHook(
      "stop",
      JSON.stringify({ transcript_path: transcriptPath, cwd: "/Users/alex/Dev/Work/mcp/agent-memory.js" }),
    );
    expect(run.code).toBe(0);
    expect(run.stdout).toBe("");
    expect(run.stderr).toMatch(/captured 2 fact/);
  });

  test("bails out when stop_hook_active is set", async () => {
    const run = await runHook(
      "stop",
      JSON.stringify({ transcript_path: transcriptPath, stop_hook_active: true }),
    );
    expect(run.code).toBe(0);
    expect(run.stderr).toBe("");
  });

  test("captures nothing when the distiller says NONE", async () => {
    const run = await runHook("stop", JSON.stringify({ transcript_path: transcriptPath }), {
      FAKE_DISTILL_OUTPUT: "NONE",
    });
    expect(run.code).toBe(0);
    expect(run.stderr).not.toMatch(/captured/);
  });

  test("stays silent when the transcript path is missing", async () => {
    const run = await runHook("stop", JSON.stringify({}));
    expect(run.code).toBe(0);
    expect(run.stderr).toBe("");
  });

  test("exits 0 even when the server is down", async () => {
    const run = await runHook(
      "stop",
      JSON.stringify({ transcript_path: transcriptPath }),
      { AGENT_MEMORY_URL: "http://127.0.0.1:9/mcp" },
    );
    expect(run.code).toBe(0);
  });
});
