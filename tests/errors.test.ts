import { describe, expect, test } from "vitest";
import { classifyToolErrorText } from "../src/errors.js";

describe("classifyToolErrorText", () => {
  test("scope denial", () => {
    expect(
      classifyToolErrorText(
        "Insufficient scope: 'memory_capture' requires 'memory:write' (caller 'readonly' has: memory:read).",
      ),
    ).toBe("scope_denied");
  });

  test("validation error", () => {
    expect(classifyToolErrorText("Error: 'query' must be a non-empty string.")).toBe("validation");
  });

  test("wildcard-only identity", () => {
    expect(
      classifyToolErrorText("This credential has no concrete namespace to capture into (wildcard-only identity)."),
    ).toBe("no_namespace");
    expect(
      classifyToolErrorText("This credential has no concrete namespace for KV access (wildcard-only identity)."),
    ).toBe("no_namespace");
  });

  test("degraded documents corpus", () => {
    expect(
      classifyToolErrorText(
        "note: the documents corpus was unavailable (vault not mounted or its embedding backend was unreachable).",
      ),
    ).toBe("degraded");
  });

  test("operational failures", () => {
    expect(classifyToolErrorText("Search failed: connect ECONNREFUSED")).toBe("failed");
    expect(classifyToolErrorText("Capture failed: boom")).toBe("failed");
    expect(classifyToolErrorText("memory_tree failed: boom")).toBe("failed");
    expect(classifyToolErrorText("memory_read_document failed: boom")).toBe("failed");
  });

  test("anything unrecognised is 'failed'", () => {
    expect(classifyToolErrorText("some novel error text")).toBe("failed");
  });
});
