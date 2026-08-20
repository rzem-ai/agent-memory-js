import { ParseError } from "../errors.js";
import type { TreeNodeState, TreeWindow } from "../types.js";
import { TREE_NODE_STATES } from "../types.js";

export function parseNumber(raw: string, text: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new ParseError(`Expected a number, got '${raw}'`, text);
  }
  return n;
}

export function parseTreeState(raw: string, text: string): TreeNodeState {
  if (!(TREE_NODE_STATES as readonly string[]).includes(raw)) {
    throw new ParseError(`Unknown tree node state '${raw}'`, text);
  }
  return raw as TreeNodeState;
}

/** Parse the formatter's `<from>..<to>` window rendering. */
export function parseWindow(raw: string, text: string): TreeWindow {
  const sep = raw.indexOf("..");
  if (sep === -1) {
    throw new ParseError(`Expected a '<from>..<to>' window, got '${raw}'`, text);
  }
  return { from: raw.slice(0, sep), to: raw.slice(sep + 2) };
}

/** Split the `\n\n`-joined records after a header, keeping `[i] ` boundaries. */
export function splitRecords(body: string): string[] {
  return body.split(/\n\n(?=\[\d+\] )/);
}
