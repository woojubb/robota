import { readTokenUsageFromMessage } from '../context/token-usage';
import { chatEntryToMessage, isChatEntry } from '../interfaces/messages';
import { randomId } from '../utils/random-id';
import { verifiedProviderCallUsage } from './provider-call-usage';

import type { TProviderUsageProvenance } from './provider-call-usage';
import type { IHistoryEntry, TUniversalMessage } from '../interfaces/messages';
import type { ITokenUsage, ITokenUsageWithCacheRead } from '../interfaces/provider';

/**
 * Aggregate token totals over a whole session/sub-session history.
 *
 * TYPE-003: alias of the usage-triple SSOT ({@link ITokenUsage}) — the aggregate shape is the
 * same triple by definition, so it is derived rather than re-declared.
 */
export type ISessionUsageTotals = ITokenUsage;

/**
 * Sum the token usage the provider reported on the assistant messages of `messages`.
 *
 * `promptTokens` sums each message's input tokens, `completionTokens` its output tokens, and
 * `totalTokens` is their sum. `cacheReadTokens` — the part of `promptTokens` served from the
 * provider's prompt cache — is present only when at least one message reported it. Returns undefined
 * when no assistant message reported usage.
 *
 * One run's usage (every provider call it made, tool rounds and a forced summary included):
 *
 * ```ts
 * const before = agent.getHistory().length;
 * await agent.run(prompt);
 * const usage = sumMessagesUsage(agent.getHistory().slice(before));
 * ```
 */
export function sumMessagesUsage(
  messages: readonly TUniversalMessage[],
): ITokenUsageWithCacheRead | undefined {
  let promptTokens = 0;
  let completionTokens = 0;
  let cacheReadTokens: number | undefined;
  let found = false;
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const usage = collectAssistantUsageMetadata(message);
    if (!usage) continue;
    found = true;
    promptTokens += usage.inputTokens;
    completionTokens += usage.outputTokens;
    if (usage.cacheReadTokens !== undefined) {
      cacheReadTokens = (cacheReadTokens ?? 0) + usage.cacheReadTokens;
    }
  }
  if (!found) return undefined;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    ...(cacheReadTokens !== undefined && { cacheReadTokens }),
  };
}

/**
 * ANALYTICS-001 (Phase 2): sum assistant token usage across a history timeline — used to capture a
 * subagent / background task's total usage so it can be attributed to its source in the parent log.
 * Returns undefined when no usage was reported (so callers can skip recording an empty entry).
 *
 * The result is exactly the usage triple: it is persisted as a background task's usage, whose record
 * declares no other key. Use {@link sumMessagesUsage} for the prompt-cache read as well.
 */
export function sumHistoryUsage(
  history: readonly IHistoryEntry[],
): ISessionUsageTotals | undefined {
  const messages = history
    .filter((entry) => isChatEntry(entry) && entry.data !== undefined)
    .map(chatEntryToMessage);
  const totals = sumMessagesUsage(messages);
  if (!totals) return undefined;
  return {
    promptTokens: totals.promptTokens,
    completionTokens: totals.completionTokens,
    totalTokens: totals.totalTokens,
  };
}

export interface IAssistantUsageMetadata {
  inputTokens: number;
  outputTokens: number;
  /** The part of `inputTokens` served from the provider's prompt cache, when it was reported. */
  cacheReadTokens?: number;
  usage: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
  };
}

export function createUsageObservationId(): string {
  return randomId();
}

export function collectAssistantUsageMetadata(
  message: TUniversalMessage,
): IAssistantUsageMetadata | undefined {
  const usage = readTokenUsageFromMessage(message);
  if (!usage) return undefined;

  const totalTokens = usage.totalTokens ?? usage.inputTokens + usage.outputTokens;
  const cacheRead =
    usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {};
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...cacheRead,
    usage: {
      totalTokens,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ...cacheRead,
    },
  };
}

/** The usage fields an assistant commit records beside its other metadata. */
export interface ICommittedUsageMetadata extends Partial<IAssistantUsageMetadata> {
  totalTokens?: number;
  usageProvenance: TProviderUsageProvenance;
}

/**
 * The usage every assistant commit (a tool round's reply, the forced summary) records for the
 * provider response it commits — one rule, so no commit path keeps usage another would drop.
 *
 * Reported input and output counts are always recorded ({@link collectAssistantUsageMetadata}: an
 * omitted total is their sum). `usageProvenance` is `complete` only when the adapter attested a
 * consistent triple ({@link verifiedProviderCallUsage}); counts recorded without that attestation —
 * an omitted total, or a total that disagrees with its parts — are `partial`.
 */
export function collectCommittedUsageMetadata(message: TUniversalMessage): ICommittedUsageMetadata {
  const provenance = verifiedProviderCallUsage(message).provenance;
  const usage = collectAssistantUsageMetadata(message);
  if (!usage) return { usageProvenance: provenance };
  return {
    ...usage,
    totalTokens: usage.usage.totalTokens,
    usageProvenance: provenance === 'complete' ? 'complete' : 'partial',
  };
}
