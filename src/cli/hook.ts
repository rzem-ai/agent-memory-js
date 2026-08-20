/**
 * Claude Code hook subcommands. Implemented in the plugin milestone;
 * this stub keeps the CLI dispatch honest until then.
 */

import type { ConnectOptions } from "../connect.js";
import { UsageError } from "./output.js";

export interface HookFlags {
  limit?: number | undefined;
  corpus?: string | undefined;
  timeoutMs?: number | undefined;
  minChars?: number | undefined;
  maxFacts?: number | undefined;
  model?: string | undefined;
}

export async function runHook(
  event: string | undefined,
  connect: ConnectOptions,
  flags: HookFlags,
): Promise<never> {
  void connect;
  void flags;
  throw new UsageError(`Unknown hook event '${event ?? ""}' (expected user-prompt or stop).`);
}
