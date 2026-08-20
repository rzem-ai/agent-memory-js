import { describe, expect, test } from "vitest";
import { ParseError } from "../../src/errors.js";
import { parseMergedResults } from "../../src/parse/index.js";
import { fixture } from "./helpers.js";

describe("parseMergedResults", () => {
  test("parses corpus 'all' with one thought and one document hit", () => {
    const parsed = parseMergedResults(fixture("merged-all.txt"));
    expect(parsed.corpus).toBe("all");
    expect(parsed.degraded).toBe(false);
    expect(parsed.hits).toHaveLength(2);

    const [thought, doc] = parsed.hits;
    expect(thought).toEqual({
      corpus: "thoughts",
      taint: "internal",
      rank: 0.812,
      similarity: 0.903,
      date: "2026-08-01",
      agentId: "angus",
      id: "3f2a8c1e-5b7d-4e9a-8c3d-1a2b3c4d5e6f",
      content: "Alex prefers pnpm for the angus2 workspace",
      tags: ["claude-code", "project:angus2"],
    });
    expect(doc).toEqual({
      corpus: "documents",
      taint: "external",
      rank: 0.641,
      similarity: 0.788,
      date: "2026-07-15",
      sourceKind: "mail",
      documentId: "mail-2026-07-15-0042",
      vaultPath: "mail/2026/07/15/kickoff.md",
      snippet: "Project kickoff notes - Agenda and decisions from the kickoff call",
    });
  });

  test("parses corpus 'documents' header", () => {
    const parsed = parseMergedResults(fixture("merged-documents.txt"));
    expect(parsed.corpus).toBe("documents");
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.hits[0]).toMatchObject({ corpus: "documents", sourceKind: "github", documentId: "gh-123" });
  });

  test("a thought without the tags suffix yields an empty tags array", () => {
    const parsed = parseMergedResults(fixture("merged-no-tags-no-excerpt.txt"));
    expect(parsed.hits[0]).toMatchObject({
      corpus: "thoughts",
      content: "A thought captured with no tags at all",
      tags: [],
    });
    // Document with no excerpt: snippet is the bare title.
    expect(parsed.hits[1]).toMatchObject({ corpus: "documents", snippet: "Untitled drop" });
  });

  test("empty sentinel yields zero hits", () => {
    const parsed = parseMergedResults(fixture("merged-empty.txt"));
    expect(parsed.hits).toEqual([]);
    expect(parsed.degraded).toBe(false);
    expect(parsed.corpus).toBeNull();
  });

  test("degraded note is detected and stripped", () => {
    const parsed = parseMergedResults(fixture("merged-all-degraded.txt"));
    expect(parsed.degraded).toBe(true);
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.hits[0]).toMatchObject({ tags: ["claude-code"] });
  });

  test("degraded empty result yields zero hits and degraded flag", () => {
    const parsed = parseMergedResults(fixture("merged-empty-degraded.txt"));
    expect(parsed.hits).toEqual([]);
    expect(parsed.degraded).toBe(true);
  });

  test("multiline thought content is kept verbatim inside one hit", () => {
    const parsed = parseMergedResults(fixture("merged-multiline-content.txt"));
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.hits[0]).toMatchObject({
      content: "First line of a multiline thought\nsecond line kept verbatim",
      tags: ["notes"],
    });
  });

  test("raw text is retained on the parsed response", () => {
    const text = fixture("merged-all.txt");
    expect(parseMergedResults(text).text).toBe(text);
  });

  test("malformed text throws ParseError carrying the offending text", () => {
    expect(() => parseMergedResults("utter garbage")).toThrowError(ParseError);
    try {
      parseMergedResults("utter garbage");
    } catch (err) {
      expect((err as ParseError).text).toBe("utter garbage");
    }
  });
});
