/**
 * Public vocabulary and result types for the agent-memory client.
 *
 * The enum arrays mirror the server's wire contract (its `src/tools/shared.ts`
 * and `src/db/schema.ts`); the parsed shapes mirror its frozen text formats in
 * `src/domain/recall.ts`. Change only in lockstep with the server.
 */

export const CORPORA = ["thoughts", "documents", "all"] as const;
export type Corpus = (typeof CORPORA)[number];

export const RELEVANCE_MODES = ["recency_weighted", "similarity", "recent", "since"] as const;
export type RelevanceMode = (typeof RELEVANCE_MODES)[number];

export const TREE_OPS = ["list", "read", "search"] as const;
export type TreeOp = (typeof TREE_OPS)[number];

export const TREE_NODE_STATES = ["open", "sealed", "summarised"] as const;
export type TreeNodeState = (typeof TREE_NODE_STATES)[number];

export const DOCUMENT_TAINTS = ["internal", "external"] as const;
export type DocumentTaint = (typeof DOCUMENT_TAINTS)[number];

/** Source kinds the server currently syncs. Parsed hits keep `sourceKind` as a
 *  plain string so a new kind on the server never breaks this client. */
export const SYNC_SOURCE_KINDS = ["mail", "github", "folder", "articles", "calendar"] as const;
export type SyncSourceKind = (typeof SYNC_SOURCE_KINDS)[number];

/** Default and hard-maximum body size for readDocument (characters). */
export const DOCUMENT_BODY_MAX_CHARS = 20_000;

/** The server's degraded-documents note, verbatim (a frozen sentinel). */
export const DOCUMENTS_UNAVAILABLE_NOTE =
  "note: the documents corpus was unavailable (vault not mounted or its embedding backend was unreachable).";

/** A thoughts-corpus search row, verbatim from the server's structuredContent
 *  (snake_case wire shape; `score` is null for non-composite modes). */
export interface RankedThought {
  id: string;
  agent_id: string;
  content: string;
  tags: string[];
  similarity: number;
  score: number | null;
  created_at: string;
}

/** A thought hit parsed from the merged (documents/all) text format.
 *  `date` is day-precision — the text carries no finer resolution. */
export interface ThoughtHit {
  corpus: "thoughts";
  taint: "internal";
  rank: number;
  similarity: number;
  date: string;
  agentId: string;
  id: string;
  content: string;
  tags: string[];
}

/** A document hit parsed from the merged text format. `snippet` is the
 *  formatter's `<title> - <excerpt>` join, which is not reliably splittable. */
export interface DocumentHit {
  corpus: "documents";
  taint: DocumentTaint;
  rank: number;
  similarity: number;
  date: string;
  sourceKind: string;
  documentId: string;
  vaultPath: string;
  snippet: string;
}

export type MergedHit = ThoughtHit | DocumentHit;

export interface ParsedMergedResults {
  /** null when the empty sentinel left no header to read the corpus from. */
  corpus: "documents" | "all" | null;
  degraded: boolean;
  hits: MergedHit[];
  /** The raw frozen text, retained so no information is ever destroyed. */
  text: string;
}

export interface TreeWindow {
  from: string;
  to: string;
}

export interface TreeListEntry {
  path: string;
  state: TreeNodeState;
  window: TreeWindow;
  docCount: number;
  /** Day-precision (`last:` in the text); null when the node never appended. */
  lastAppendedDate: string | null;
}

export interface ParsedTreeList {
  scope: string;
  entries: TreeListEntry[];
}

export interface ParsedTreeNode {
  path: string;
  state: TreeNodeState;
  window: TreeWindow;
  docCount: number;
  /** Full ISO timestamp (`last appended:` keeps raw precision in the text). */
  lastAppendedAt: string | null;
  summaryMd: string | null;
}

export interface TreeSearchHit {
  path: string;
  state: TreeNodeState;
  rank: number;
  similarity: number;
  window: TreeWindow;
  excerpt: string | null;
}

export interface ParsedTreeSearch {
  /** null when the empty sentinel left no header to read the query from. */
  query: string | null;
  results: TreeSearchHit[];
}

export interface ParsedDocument {
  id: string;
  title: string;
  sourceKind: string;
  externalId: string;
  taint: DocumentTaint;
  score: number;
  eventAt: string;
  ingestedAt: string;
  vaultPath: string;
  provenance: Record<string, unknown>;
  bodySource: "vault" | "chunks";
  truncated: boolean;
  body: string;
}
