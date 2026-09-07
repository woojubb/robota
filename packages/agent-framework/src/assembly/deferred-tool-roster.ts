/**
 * The deferred half of a session's tool surface, as system-prompt lines (CLI-1990 § Solution 6).
 *
 * Split from `create-session-runtime.ts` on a real seam rather than for line count: that module
 * ASSEMBLES the prompt from many contributors, while this one DERIVES one contributor from the
 * assembled tool set. The derivation is the part worth testing on its own, and it is the only part
 * of the tool-description surface that is computed rather than hand-maintained.
 *
 * Why it exists at all: a tool declaring `deferLoading` is withheld from the request while deferral
 * is engaged, so the model never sees its schema. Without a roster the model is not told such a tool
 * exists — and a tool it does not know about is one it will never search for. The roster is what
 * makes the withheld half of the surface reachable.
 */

import type { IToolWithEventService } from '@robota-sdk/agent-core';

/**
 * The header that opens the roster.
 *
 * It names `ToolSearch` deliberately: a list of tools the model cannot act on is worse than no list,
 * so the line that announces them also says how to load one.
 */
export const DEFERRED_TOOL_ROSTER_HEADER =
  'Tools available but NOT loaded — their schemas are withheld. Call ToolSearch to load one before using it:';

/** Longest description kept per roster line: a roster is an index, not a second tool list. */
const DEFERRED_ROSTER_DESCRIPTION_LIMIT = 120;

/** A tool's description reduced to one short line — its first line, capped. */
function summarise(description: string): string {
  const firstLine = description.split('\n')[0]?.trim() ?? '';
  return firstLine.length > DEFERRED_ROSTER_DESCRIPTION_LIMIT
    ? `${firstLine.slice(0, DEFERRED_ROSTER_DESCRIPTION_LIMIT).trimEnd()}…`
    : firstLine;
}

/**
 * The deferred tools among `tools`, as `name — description` prompt lines behind the header.
 *
 * Derived from the tools the session actually assembled — it has to be, since what is deferred is a
 * per-session fact. Returns an EMPTY array when nothing is deferred, so a session with no deferred
 * tool produces a prompt byte-identical to the one it produced before this roster existed.
 */
export function formatDeferredToolRoster(tools: readonly IToolWithEventService[]): string[] {
  const deferred = tools.filter((tool) => tool.schema.deferLoading === true);
  if (deferred.length === 0) return [];
  return [
    DEFERRED_TOOL_ROSTER_HEADER,
    ...deferred.map((tool) => `${tool.schema.name} — ${summarise(tool.schema.description)}`),
  ];
}
