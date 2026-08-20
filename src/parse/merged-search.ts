/**
 * Inverse of the server's `formatMergedResults` (src/domain/recall.ts) — the
 * frozen text contract for memory_search over corpus 'documents' and 'all'.
 *
 * Known, inherent lossiness of that contract: dates are day-precision, a
 * document's `<title> - <excerpt>` join is not reliably splittable, and thought
 * content containing ` | tags: ` or a blank line followed by `[i] ` mis-splits.
 */

import { ParseError } from "../errors.js";
import type { DocumentHit, DocumentTaint, MergedHit, ParsedMergedResults, ThoughtHit } from "../types.js";
import { DOCUMENTS_UNAVAILABLE_NOTE, DOCUMENT_TAINTS } from "../types.js";
import { parseNumber, splitRecords } from "./shared.js";

const EMPTY_SENTINEL = "No matching memories found.";
const HEAD_RE =
  /^\[\d+\] corpus: (thoughts|documents) \| taint: ([a-z]+) \| rank: ([0-9.]+) \| sim: ([0-9.]+) \| ([^|]+?) \| (.+)$/;
const THOUGHT_TAIL_RE = /^agent: (.+) \| id: (\S+)$/;
const DOCUMENT_TAIL_RE = /^source: (\S+) \| doc: (\S+) \| path: (.+)$/;
const TAGS_SEPARATOR = " | tags: ";

function parseTaint(raw: string, text: string): DocumentTaint {
  if (!(DOCUMENT_TAINTS as readonly string[]).includes(raw)) {
    throw new ParseError(`Unknown taint '${raw}'`, text);
  }
  return raw as DocumentTaint;
}

function parseRecord(record: string, text: string): MergedHit {
  const bodySep = record.indexOf("\n    ");
  if (bodySep === -1) {
    throw new ParseError("Merged-search record has no indented body line", text);
  }
  const head = HEAD_RE.exec(record.slice(0, bodySep));
  if (!head) {
    throw new ParseError("Merged-search record header did not match the frozen format", text);
  }
  const [corpus, taint, tail] = [head[1]!, head[2]!, head[6]!];
  const body = record.slice(bodySep + 5);
  const common = {
    rank: parseNumber(head[3]!, text),
    similarity: parseNumber(head[4]!, text),
    date: head[5]!,
  };

  if (corpus === "thoughts") {
    const t = THOUGHT_TAIL_RE.exec(tail);
    if (!t) {
      throw new ParseError("Thought record tail did not match the frozen format", text);
    }
    if (taint !== "internal") {
      throw new ParseError(`Thought record with non-internal taint '${taint}'`, text);
    }
    const tagsAt = body.lastIndexOf(TAGS_SEPARATOR);
    const hit: ThoughtHit = {
      corpus: "thoughts",
      taint: "internal",
      ...common,
      agentId: t[1]!,
      id: t[2]!,
      content: tagsAt === -1 ? body : body.slice(0, tagsAt),
      tags: tagsAt === -1 ? [] : body.slice(tagsAt + TAGS_SEPARATOR.length).split(", "),
    };
    return hit;
  }

  const d = DOCUMENT_TAIL_RE.exec(tail);
  if (!d) {
    throw new ParseError("Document record tail did not match the frozen format", text);
  }
  const hit: DocumentHit = {
    corpus: "documents",
    taint: parseTaint(taint, text),
    ...common,
    sourceKind: d[1]!,
    documentId: d[2]!,
    vaultPath: d[3]!,
    snippet: body,
  };
  return hit;
}

export function parseMergedResults(text: string): ParsedMergedResults {
  let body = text;
  let degraded = false;

  if (body === DOCUMENTS_UNAVAILABLE_NOTE) {
    return { corpus: null, degraded: true, hits: [], text };
  }
  const noteSuffix = `\n\n${DOCUMENTS_UNAVAILABLE_NOTE}`;
  if (body.endsWith(noteSuffix)) {
    degraded = true;
    body = body.slice(0, -noteSuffix.length);
  }
  if (body === EMPTY_SENTINEL) {
    return { corpus: null, degraded, hits: [], text };
  }

  const headerEnd = body.indexOf("\n\n");
  if (headerEnd === -1) {
    throw new ParseError("Merged-search text has no header/body separator", text);
  }
  const header = body.slice(0, headerEnd);
  let corpus: "documents" | "all";
  if (header === "corpus: all (thoughts + documents)") {
    corpus = "all";
  } else if (header === "corpus: documents") {
    corpus = "documents";
  } else {
    throw new ParseError(`Unrecognised merged-search header '${header}'`, text);
  }

  const hits = splitRecords(body.slice(headerEnd + 2)).map((record) => parseRecord(record, text));
  return { corpus, degraded, hits, text };
}
