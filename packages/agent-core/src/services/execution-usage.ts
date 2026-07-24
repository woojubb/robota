import { readTokenUsageFromMessage } from '../context/token-usage';
import { chatEntryToMessage, isChatEntry } from '../interfaces/messages';

import type { IHistoryEntry, TUniversalMessage } from '../interfaces/messages';
import type { ITokenUsage } from '../interfaces/provider';

/**
 * Aggregate token totals over a whole session/sub-session history.
 *
 * TYPE-003: alias of the usage-triple SSOT ({@link ITokenUsage}) — the aggregate shape is the
 * same triple by definition, so it is derived rather than re-declared.
 */
export type ISessionUsageTotals = ITokenUsage;

/**
 * ANALYTICS-001 (Phase 2): sum assistant token usage across a history timeline — used to capture a
 * subagent / background task's total usage so it can be attributed to its source in the parent log.
 * Returns undefined when no usage was reported (so callers can skip recording an empty entry).
 */
export function sumHistoryUsage(
  history: readonly IHistoryEntry[],
): ISessionUsageTotals | undefined {
  let promptTokens = 0;
  let completionTokens = 0;
  let found = false;
  for (const entry of history) {
    if (!isChatEntry(entry) || entry.data === undefined) continue;
    const message = chatEntryToMessage(entry);
    if (message.role !== 'assistant') continue;
    const usage = collectAssistantUsageMetadata(message);
    if (!usage) continue;
    found = true;
    promptTokens += usage.inputTokens;
    completionTokens += usage.outputTokens;
  }
  if (!found) return undefined;
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

export interface IAssistantUsageMetadata {
  inputTokens: number;
  outputTokens: number;
  usage: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
  };
}

export function collectAssistantUsageMetadata(
  message: TUniversalMessage,
): IAssistantUsageMetadata | undefined {
  const usage = readTokenUsageFromMessage(message);
  if (!usage) return undefined;

  const totalTokens = usage.totalTokens ?? usage.inputTokens + usage.outputTokens;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    usage: {
      totalTokens,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    },
  };
}
