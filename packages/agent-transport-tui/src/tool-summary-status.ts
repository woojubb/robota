/**
 * Persisted tool-summary → status-SSOT mapping (SCREEN-006).
 *
 * MessageList used to hand-roll its own glyph/color mapping for tool summaries, which drifted
 * from `status-glyph.ts` (denied rendered plain yellow vs the SSOT's yellowBright). These
 * helpers route the persisted summary items through `toolStateStatusKind` + `STATUS_GLYPH`
 * so tool status renders one way everywhere.
 */

import { humanizeToolName } from './humanize-tool-name.js';
import { STATUS_GLYPH, toolStateStatusKind } from './status-glyph.js';

import type { TUiStatusKind } from './status-glyph.js';
import type { IToolCallSummary } from './utils/tool-call-extractor.js';
import type { IToolState } from '@robota-sdk/agent-interface-transport';

/** A tool item as persisted in a `tool-summary` history entry (loosely-typed session data). */
export type TToolSummaryItem = {
  toolName: string;
  firstArg?: string;
  isRunning?: boolean;
  result?: string;
  diffLines?: IToolCallSummary['diffLines'];
  diffFile?: string;
  toolResultData?: string;
};

/**
 * Map a persisted tool-summary item to the semantic status kind — via the `status-glyph.ts`
 * SSOT. A command-output error (non-zero exit surfaced by `formatCommandOutputSummary`)
 * overrides the recorded result; the caller passes that flag so this module stays free of
 * the command-output dependency.
 */
export function toolSummaryStatusKind(
  tool: TToolSummaryItem,
  hasCommandOutputError: boolean,
): TUiStatusKind {
  if (hasCommandOutputError) return 'error';
  const result: IToolState['result'] =
    tool.result === 'success' || tool.result === 'error' || tool.result === 'denied'
      ? tool.result
      : undefined;
  return toolStateStatusKind({
    toolName: tool.toolName,
    firstArg: tool.firstArg ?? '',
    isRunning: tool.isRunning ?? false,
    result,
  });
}

/** One-line summary label: SSOT glyph + humanized tool name + first argument. */
export function getToolSummaryLabel(tool: TToolSummaryItem, kind: TUiStatusKind): string {
  return `${STATUS_GLYPH[kind].symbol} ${humanizeToolName(tool.toolName)}${tool.firstArg ? `(${tool.firstArg})` : ''}`;
}
