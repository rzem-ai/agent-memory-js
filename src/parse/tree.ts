/**
 * Inverses of the server's `formatTreeList` / `formatTreeNode` /
 * `formatTreeSearch` (src/domain/recall.ts) — the frozen text contract for
 * memory_tree. List rows join with single newlines; search records with blank
 * lines; a node read keeps `last appended:` at full ISO precision.
 */

import { ParseError } from "../errors.js";
import type { ParsedTreeList, ParsedTreeNode, ParsedTreeSearch, TreeListEntry, TreeSearchHit } from "../types.js";
import { parseNumber, parseTreeState, parseWindow, splitRecords } from "./shared.js";

const LIST_EMPTY_RE = /^No tree nodes under (.+)\.$/;
const LIST_HEADER_RE = /^tree under (.+) \(\d+\):$/;
const LIST_ENTRY_RE = /^- (.+) \| (\S+) \| window: (\S+) \| docs: (\d+)(?: \| last: (\S+))?$/;

export function parseTreeList(text: string): ParsedTreeList {
  const empty = LIST_EMPTY_RE.exec(text);
  if (empty) {
    return { scope: empty[1]!, entries: [] };
  }
  const lines = text.split("\n");
  const header = LIST_HEADER_RE.exec(lines[0] ?? "");
  if (!header) {
    throw new ParseError("Tree-list text did not match the frozen format", text);
  }
  const entries: TreeListEntry[] = lines.slice(1).map((line) => {
    const m = LIST_ENTRY_RE.exec(line);
    if (!m) {
      throw new ParseError(`Tree-list entry did not match the frozen format: '${line}'`, text);
    }
    return {
      path: m[1]!,
      state: parseTreeState(m[2]!, text),
      window: parseWindow(m[3]!, text),
      docCount: parseNumber(m[4]!, text),
      lastAppendedDate: m[5] ?? null,
    };
  });
  return { scope: header[1]!, entries };
}

const NODE_NO_SUMMARY_RE = /^\(No summary yet - this node is still \S+\.\)$/;

export function parseTreeNode(text: string): ParsedTreeNode {
  const metaEnd = text.indexOf("\n\n");
  if (metaEnd === -1) {
    throw new ParseError("Tree-node text has no metadata/summary separator", text);
  }
  const meta = new Map<string, string>();
  for (const line of text.slice(0, metaEnd).split("\n")) {
    const sep = line.indexOf(": ");
    if (sep === -1) {
      throw new ParseError(`Tree-node metadata line did not match the frozen format: '${line}'`, text);
    }
    meta.set(line.slice(0, sep), line.slice(sep + 2));
  }
  const required = (key: string): string => {
    const value = meta.get(key);
    if (value === undefined) {
      throw new ParseError(`Tree-node metadata is missing '${key}'`, text);
    }
    return value;
  };
  const summary = text.slice(metaEnd + 2);
  return {
    path: required("path"),
    state: parseTreeState(required("state"), text),
    window: parseWindow(required("window"), text),
    docCount: parseNumber(required("docs"), text),
    lastAppendedAt: meta.get("last appended") ?? null,
    summaryMd: NODE_NO_SUMMARY_RE.test(summary) ? null : summary,
  };
}

const SEARCH_EMPTY_SENTINEL = "No matching tree nodes found.";
const SEARCH_HEADER_RE = /^tree search: (.+)$/;
const SEARCH_HIT_RE = /^\[\d+\] (.+) \| (\S+) \| rank: ([0-9.]+) \| sim: ([0-9.]+) \| window: (\S+)$/;

export function parseTreeSearch(text: string): ParsedTreeSearch {
  if (text === SEARCH_EMPTY_SENTINEL) {
    return { query: null, results: [] };
  }
  const headerEnd = text.indexOf("\n\n");
  if (headerEnd === -1) {
    throw new ParseError("Tree-search text has no header/body separator", text);
  }
  const header = SEARCH_HEADER_RE.exec(text.slice(0, headerEnd));
  if (!header) {
    throw new ParseError("Tree-search header did not match the frozen format", text);
  }
  const results: TreeSearchHit[] = splitRecords(text.slice(headerEnd + 2)).map((record) => {
    const lineEnd = record.indexOf("\n    ");
    const head = SEARCH_HIT_RE.exec(lineEnd === -1 ? record : record.slice(0, lineEnd));
    if (!head) {
      throw new ParseError(`Tree-search hit did not match the frozen format: '${record}'`, text);
    }
    return {
      path: head[1]!,
      state: parseTreeState(head[2]!, text),
      rank: parseNumber(head[3]!, text),
      similarity: parseNumber(head[4]!, text),
      window: parseWindow(head[5]!, text),
      excerpt: lineEnd === -1 ? null : record.slice(lineEnd + 5),
    };
  });
  return { query: header[1]!, results };
}
