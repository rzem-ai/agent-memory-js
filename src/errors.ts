/**
 * Error taxonomy, matching how failures actually arrive from the server:
 * transport-level (network, timeout, HTTP 401) vs tool results flagged
 * `isError: true` (classified by their frozen text prefixes) vs frozen-text
 * drift the parsers could not follow.
 */

import { DOCUMENTS_UNAVAILABLE_NOTE } from "./types.js";

export class AgentMemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Network / spawn / timeout / protocol failure below the tool layer. */
export class TransportError extends AgentMemoryError {}

/** HTTP 401 — missing or rejected credential. */
export class AuthError extends TransportError {}

export type ToolErrorKind = "scope_denied" | "validation" | "no_namespace" | "degraded" | "failed";

/** Classify an `isError: true` tool-result text by its frozen prefix. */
export function classifyToolErrorText(text: string): ToolErrorKind {
  if (text.startsWith("Insufficient scope:")) {
    return "scope_denied";
  }
  if (text.startsWith("Error:")) {
    return "validation";
  }
  if (text.startsWith("This credential has no concrete namespace")) {
    return "no_namespace";
  }
  if (text === DOCUMENTS_UNAVAILABLE_NOTE) {
    return "degraded";
  }
  return "failed";
}

/** A tool result the server flagged `isError: true`. */
export class ToolError extends AgentMemoryError {
  readonly tool: string;
  readonly text: string;
  readonly kind: ToolErrorKind;

  constructor(tool: string, text: string) {
    super(`${tool}: ${text}`);
    this.tool = tool;
    this.text = text;
    this.kind = classifyToolErrorText(text);
  }
}

/** The server's frozen text no longer matches what this client can parse. */
export class ParseError extends AgentMemoryError {
  /** The offending text, in full, for diagnosis. */
  readonly text: string;

  constructor(message: string, text: string) {
    super(message);
    this.text = text;
  }
}
