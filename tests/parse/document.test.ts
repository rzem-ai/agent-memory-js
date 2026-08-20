import { describe, expect, test } from "vitest";
import { ParseError } from "../../src/errors.js";
import { parseDocument } from "../../src/parse/index.js";
import { fixture } from "./helpers.js";

describe("parseDocument", () => {
  test("parses the full header and keeps colon-lines and blank lines in the body", () => {
    const parsed = parseDocument(fixture("document-full.txt"));
    expect(parsed).toEqual({
      id: "mail-2026-07-15-0042",
      title: "Project kickoff notes",
      sourceKind: "mail",
      externalId: "<CAExample@mail.gmail.com>",
      taint: "external",
      score: 0.85,
      eventAt: "2026-07-15T09:30:00.000Z",
      ingestedAt: "2026-07-15T10:02:11.000Z",
      vaultPath: "mail/2026/07/15/kickoff.md",
      provenance: { from: "pm@example.com", thread: "kickoff" },
      bodySource: "vault",
      truncated: false,
      body: "# Kickoff\n\nAgenda:\n\n- item one\n\nevent_at: this line is body content, not a header",
    });
  });

  test("parses the truncation note and '(none)' provenance", () => {
    const parsed = parseDocument(fixture("document-truncated.txt"));
    expect(parsed.truncated).toBe(true);
    expect(parsed.provenance).toEqual({});
    expect(parsed.bodySource).toBe("chunks");
    expect(parsed.body).toBe("This body was cut off at exactly forty-four");
  });

  test("malformed text throws ParseError", () => {
    expect(() => parseDocument("not a document")).toThrowError(ParseError);
  });
});
