/**
 * Inverse of the server's `formatDocument` (src/domain/recall.ts) — the frozen
 * text contract for memory_read_document: eleven fixed-order header lines, an
 * optional truncation note, a blank line, then the verbatim Markdown body. The
 * body may itself contain blank lines and `key: value`-looking lines, so the
 * split happens after the known header keys — never at the first blank line.
 */

import { ParseError } from "../errors.js";
import type { ParsedDocument } from "../types.js";
import { DOCUMENT_TAINTS } from "../types.js";
import { parseNumber } from "./shared.js";

const HEADER_KEYS = [
  "id",
  "title",
  "source",
  "external_id",
  "taint",
  "score",
  "event_at",
  "ingested_at",
  "vault_path",
  "provenance",
  "body_source",
] as const;

const TRUNCATION_NOTE_RE = /^note: body truncated to \d+ characters$/;

function parseProvenance(raw: string, text: string): Record<string, unknown> {
  if (raw === "(none)") {
    return {};
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ParseError(`Document provenance is neither '(none)' nor JSON: '${raw}'`, text);
  }
}

export function parseDocument(text: string): ParsedDocument {
  const lines = text.split("\n");
  const fields: Record<string, string> = {};
  for (const [index, key] of HEADER_KEYS.entries()) {
    const line = lines[index];
    if (line === undefined || !line.startsWith(`${key}: `)) {
      throw new ParseError(`Document header line ${index + 1} is not '${key}: ...'`, text);
    }
    fields[key] = line.slice(key.length + 2);
  }

  let next = HEADER_KEYS.length;
  const afterHeader = lines[next];
  const truncated = afterHeader !== undefined && TRUNCATION_NOTE_RE.test(afterHeader);
  if (truncated) {
    next += 1;
  }
  if (lines[next] !== "") {
    throw new ParseError("Document header is not followed by a blank line", text);
  }

  const taint = fields["taint"]!;
  if (!(DOCUMENT_TAINTS as readonly string[]).includes(taint)) {
    throw new ParseError(`Unknown document taint '${taint}'`, text);
  }
  const bodySource = fields["body_source"]!;
  if (bodySource !== "vault" && bodySource !== "chunks") {
    throw new ParseError(`Unknown body_source '${bodySource}'`, text);
  }

  return {
    id: fields["id"]!,
    title: fields["title"]!,
    sourceKind: fields["source"]!,
    externalId: fields["external_id"]!,
    taint: taint as ParsedDocument["taint"],
    score: parseNumber(fields["score"]!, text),
    eventAt: fields["event_at"]!,
    ingestedAt: fields["ingested_at"]!,
    vaultPath: fields["vault_path"]!,
    provenance: parseProvenance(fields["provenance"]!, text),
    bodySource,
    truncated,
    body: lines.slice(next + 1).join("\n"),
  };
}
