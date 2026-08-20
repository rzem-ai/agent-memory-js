/**
 * CLI output + exit-code policy. Machine consumers get one JSON envelope on
 * stdout; humans get the server's frozen text verbatim. --fail-open forces
 * exit 0 whatever happened (the hook contract: a down memory server must
 * never break the caller), while still printing the error envelope unless
 * --quiet.
 */

import { AuthError, ParseError, ToolError, TransportError } from "../errors.js";

export interface OutputFlags {
  json: boolean;
  failOpen: boolean;
  quiet: boolean;
}

export type ErrorKind = "auth" | "transport" | "tool" | "parse" | "usage";

const EXIT_CODES: Record<ErrorKind, number> = {
  tool: 1,
  parse: 1,
  usage: 2,
  transport: 3,
  auth: 4,
};

/** A bad invocation (unknown command, missing argument). */
export class UsageError extends Error {}

export function emitOk(flags: OutputFlags, tool: string, data: unknown, text?: string): void {
  if (flags.quiet) {
    return;
  }
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, tool, data, ...(text !== undefined ? { text } : {}) })}\n`);
    return;
  }
  if (text !== undefined) {
    process.stdout.write(`${text}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export function classifyError(err: unknown): { kind: ErrorKind; message: string; detail?: Record<string, unknown> } {
  if (err instanceof AuthError) {
    return { kind: "auth", message: err.message };
  }
  if (err instanceof TransportError) {
    return { kind: "transport", message: err.message };
  }
  if (err instanceof ToolError) {
    return { kind: "tool", message: err.text, detail: { tool: err.tool, toolKind: err.kind } };
  }
  if (err instanceof ParseError) {
    return { kind: "parse", message: err.message, detail: { text: err.text } };
  }
  if (err instanceof UsageError) {
    return { kind: "usage", message: err.message };
  }
  return { kind: "transport", message: err instanceof Error ? err.message : String(err) };
}

/** Print the failure and return the process exit code to use. */
export function emitError(flags: OutputFlags, err: unknown): number {
  const { kind, message, detail } = classifyError(err);
  if (!flags.quiet) {
    if (flags.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { kind, message, ...detail } })}\n`);
    } else {
      process.stderr.write(`agent-memory-js: ${kind}: ${message}\n`);
    }
  }
  return flags.failOpen ? 0 : EXIT_CODES[kind];
}
