import { describe, expect, test } from "vitest";
import { ParseError } from "../../src/errors.js";
import { parseTreeList, parseTreeNode, parseTreeSearch } from "../../src/parse/index.js";
import { fixture } from "./helpers.js";

describe("parseTreeList", () => {
  test("parses roots listing with and without a 'last:' field", () => {
    const parsed = parseTreeList(fixture("tree-list-roots.txt"));
    expect(parsed.scope).toBe("roots");
    expect(parsed.entries).toEqual([
      {
        path: "mail/2026",
        state: "open",
        window: { from: "2026-01-01", to: "2026-08-15" },
        docCount: 412,
        lastAppendedDate: "2026-08-15",
      },
      {
        path: "github/2026",
        state: "summarised",
        window: { from: "2026-01-02", to: "2026-08-10" },
        docCount: 178,
        lastAppendedDate: null,
      },
    ]);
  });

  test("empty sentinel yields zero entries and the scope", () => {
    const parsed = parseTreeList(fixture("tree-list-empty.txt"));
    expect(parsed.scope).toBe("mail/2031");
    expect(parsed.entries).toEqual([]);
  });

  test("malformed text throws ParseError", () => {
    expect(() => parseTreeList("nope")).toThrowError(ParseError);
  });
});

describe("parseTreeNode", () => {
  test("parses a summarised node with a multi-paragraph summary", () => {
    const parsed = parseTreeNode(fixture("tree-node-summarised.txt"));
    expect(parsed).toEqual({
      path: "mail/2026/07",
      state: "summarised",
      window: { from: "2026-07-01", to: "2026-07-31" },
      docCount: 58,
      lastAppendedAt: "2026-07-31T22:14:09.000Z",
      summaryMd: "## July mail\n\n- Kickoff thread with the platform team.\n\nSecond paragraph with detail.",
    });
  });

  test("an unsummarised node yields summaryMd null and no lastAppendedAt", () => {
    const parsed = parseTreeNode(fixture("tree-node-open.txt"));
    expect(parsed).toEqual({
      path: "mail/2026/08",
      state: "open",
      window: { from: "2026-08-01", to: "2026-08-15" },
      docCount: 23,
      lastAppendedAt: null,
      summaryMd: null,
    });
  });
});

describe("parseTreeSearch", () => {
  test("parses hits with and without an excerpt line", () => {
    const parsed = parseTreeSearch(fixture("tree-search.txt"));
    expect(parsed.query).toBe("kickoff planning");
    expect(parsed.results).toEqual([
      {
        path: "mail/2026/07",
        state: "summarised",
        rank: 0.912,
        similarity: 0.801,
        window: { from: "2026-07-01", to: "2026-07-31" },
        excerpt: "July mail: kickoff thread with the platform team",
      },
      {
        path: "github/2026/06",
        state: "summarised",
        rank: 0.454,
        similarity: 0.454,
        window: { from: "2026-06-01", to: "2026-06-30" },
        excerpt: null,
      },
    ]);
  });

  test("empty sentinel yields zero results", () => {
    const parsed = parseTreeSearch(fixture("tree-search-empty.txt"));
    expect(parsed.results).toEqual([]);
    expect(parsed.query).toBeNull();
  });
});
