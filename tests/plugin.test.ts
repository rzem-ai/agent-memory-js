/**
 * Structural checks for the shipped Claude Code plugin, so a plugin regression
 * fails `npm test` without needing the `claude` binary.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const KNOWN_HOOK_EVENTS = new Set([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Stop",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "PreCompact",
  "Notification",
]);

function readJson(relative: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`../${relative}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("plugin structure", () => {
  test("plugin.json names the plugin agent-memory (the mcp__agent-memory__* namespace)", () => {
    const manifest = readJson("plugin/.claude-plugin/plugin.json");
    expect(manifest["name"]).toBe("agent-memory");
    expect(typeof manifest["version"]).toBe("string");
    expect(typeof manifest["description"]).toBe("string");
  });

  test(".mcp.json registers exactly one http server named agent-memory", () => {
    const mcp = readJson("plugin/.mcp.json");
    const servers = mcp["mcpServers"] as Record<string, Record<string, unknown>>;
    expect(Object.keys(servers)).toEqual(["agent-memory"]);
    expect(servers["agent-memory"]).toMatchObject({ type: "http" });
    expect(servers["agent-memory"]!["url"]).toContain("${AGENT_MEMORY_URL");
    expect(JSON.stringify(servers["agent-memory"]!["headers"])).toContain("${AGENT_MEMORY_TOKEN}");
  });

  test("hooks.json uses the plugin wrapper format with known events and portable paths", () => {
    const config = readJson("plugin/hooks/hooks.json");
    const hooks = config["hooks"] as Record<string, { hooks: { type: string; command: string }[] }[]>;
    expect(Object.keys(hooks).sort()).toEqual(["Stop", "UserPromptSubmit"]);
    for (const [event, matchers] of Object.entries(hooks)) {
      expect(KNOWN_HOOK_EVENTS.has(event)).toBe(true);
      for (const matcher of matchers) {
        for (const hook of matcher.hooks) {
          expect(hook.type).toBe("command");
          expect(hook.command).toContain("${CLAUDE_PLUGIN_ROOT}");
        }
      }
    }
  });

  test("hook scripts exist, are non-empty, and never exit non-zero deliberately", () => {
    for (const name of ["user-prompt-submit.sh", "stop.sh"]) {
      const path = fileURLToPath(new URL(`../plugin/scripts/${name}`, import.meta.url));
      const script = readFileSync(path, "utf8");
      expect(script.length).toBeGreaterThan(0);
      expect(script).toContain("exit 0");
      expect(script).not.toMatch(/^\s*exit [1-9]/m);
    }
  });

  test("the using-memory skill has frontmatter with name and description", () => {
    const path = fileURLToPath(new URL("../plugin/skills/using-memory/SKILL.md", import.meta.url));
    const skill = readFileSync(path, "utf8");
    expect(skill.startsWith("---\n")).toBe(true);
    expect(skill).toContain("name: using-memory");
    expect(skill).toContain("description: Use when");
  });

  test("marketplace.json points at ./plugin", () => {
    const marketplace = readJson(".claude-plugin/marketplace.json");
    const plugins = marketplace["plugins"] as { name: string; source: string }[];
    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({ name: "agent-memory", source: "./plugin" });
  });
});
