/**
 * Prompt execution helpers for InteractiveSession.
 *
 * Contains abort detection, tool-summary extraction, and prompt preparation utilities.
 */

import { randomUUID } from 'node:crypto';

import {
  collectAssistantUsageMetadata,
  calculateModelCost,
  isAbortFailure,
  SPAN_EVENTS,
} from '@robota-sdk/agent-core';

import type { IExecutionResult, IToolSummary, IUsageSnapshot } from './types.js';
import type { IPromptFileReferenceRecord } from '../context/prompt-file-references.js';
import type { IContextWindowState, ITokenUsage, TUniversalMessage } from '@robota-sdk/agent-core';
import type {
  IHistoryEntry,
  ISpanCompletionEventData,
  IEventService,
  TEventListener,
} from '@robota-sdk/agent-core';
import type { IUsageSource, ISpanEntry } from '@robota-sdk/agent-interface-analytics';

/** Detect an abort/cancel. CORE-027: the substring heuristic that stood here reported a provider
 * failure as the user's own cancellation; `isAbortFailure` owns the decision and says why. */
export function isAbortError(err: unknown): boolean {
  return isAbortFailure(err);
}

/**
 * Extract tool call summaries from a session history slice.
 *
 * Scans history entries from `historyBefore` onwards and collects
 * tool call records from assistant messages.
 */
function extractToolSummaries(history: TUniversalMessage[], historyBefore: number): IToolSummary[] {
  const summaries: IToolSummary[] = [];
  for (let i = historyBefore; i < history.length; i++) {
    const msg = history[i];
    if (msg?.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls as Array<{
        function: { name: string; arguments: string };
      }>) {
        summaries.push({ name: tc.function.name, args: tc.function.arguments });
      }
    }
  }
  return summaries;
}

/**
 * Build an IExecutionResult from a completed response.
 */
export function buildResult(
  response: string,
  sessionHistory: TUniversalMessage[],
  interactiveHistory: IHistoryEntry[],
  historyBefore: number,
  contextState: IContextWindowState,
  promptFileReferences?: readonly IPromptFileReferenceRecord[],
  modelId?: string,
): IExecutionResult {
  const toolSummaries = extractToolSummaries(sessionHistory, historyBefore);
  const usage = extractTurnUsage(sessionHistory, historyBefore, contextState, modelId);
  return {
    response,
    history: interactiveHistory,
    toolSummaries,
    contextState,
    ...(usage && { usage }),
    ...(promptFileReferences && promptFileReferences.length > 0
      ? { promptFileReferences: [...promptFileReferences] }
      : {}),
  };
}

/**
 * Build an IExecutionResult for an interrupted (aborted) execution.
 * Collects any partial assistant text accumulated before the abort.
 */
export function buildInterruptedResult(
  sessionHistory: TUniversalMessage[],
  interactiveHistory: IHistoryEntry[],
  historyBefore: number,
  contextState: IContextWindowState,
  modelId?: string,
): IExecutionResult {
  const toolSummaries = extractToolSummaries(sessionHistory, historyBefore);
  const parts: string[] = [];
  for (let i = historyBefore; i < sessionHistory.length; i++) {
    const msg = sessionHistory[i];
    if (msg?.role === 'assistant' && msg.content) parts.push(msg.content);
  }
  const usage = extractTurnUsage(sessionHistory, historyBefore, contextState, modelId);
  return {
    response: parts.join('\n\n'),
    history: interactiveHistory,
    toolSummaries,
    contextState,
    ...(usage && { usage }),
  };
}

export function createUsageSummaryEntry(usage: IUsageSnapshot): IHistoryEntry<IUsageSnapshot> {
  return {
    id: `usage_${randomUUID()}`,
    timestamp: new Date(),
    category: 'event',
    type: 'usage-summary',
    data: usage,
  };
}

/**
 * ANALYTICS-001 (Phase 2): build a usage-summary entry attributed to a non-main source (a subagent /
 * background task) so the parent session log can report token usage per source. Context fields are
 * not meaningful for a child run and are left at 0; the usage reducer only reads the token totals.
 * Cost is NOT derived here (no model id is in scope for the child run), so `costStatus: 'unknown'`
 * and `costUsd` is omitted — honoring the SELFHOST-004 invariant "costUsd present iff costStatus !==
 * 'unknown'" (the `kind: 'exact'` still reflects exact TOKENS).
 */
export function createSourceUsageSummaryEntry(
  totals: ITokenUsage,
  source: IUsageSource,
): IHistoryEntry<IUsageSnapshot> {
  return createUsageSummaryEntry({
    kind: 'exact',
    scope: 'turn',
    totalTokens: totals.totalTokens,
    promptTokens: totals.promptTokens,
    completionTokens: totals.completionTokens,
    contextUsedTokens: 0,
    contextMaxTokens: 0,
    contextUsedPercentage: 0,
    costStatus: 'unknown',
    source,
  });
}

/**
 * SELFHOST-004 (P2, TC-07): build a per-operation span entry from the `agent-core` span-completion
 * event (`ISpanCompletionEventData`), mirroring `createUsageSummaryEntry`. This is the ONLY place the
 * event's joined `spanId + durationMs + op` becomes a record-side `IHistoryEntry<ISpanEntry>` — so
 * `agent-core` surfaces raw timing while `agent-framework` (which already depends on transport) owns
 * the record projection. No `agent-core → agent-interface-transport` edge; no `agent-plugin` edge.
 */
export function createSpanEntry(event: ISpanCompletionEventData): IHistoryEntry<ISpanEntry> {
  return {
    id: `span_${randomUUID()}`,
    timestamp: new Date(),
    category: 'event',
    type: 'span',
    data: {
      spanId: event.spanId,
      op: event.op,
      durationMs: event.durationMs,
    },
  };
}

/** A live span collector: buffers span entries seen on the bus until disposed. */
export interface ISpanCollector {
  /** The span entries observed since subscription, in emit order. */
  readonly entries: IHistoryEntry<ISpanEntry>[];
  /** Unsubscribe from the bus (idempotent). */
  dispose(): void;
}

/**
 * SELFHOST-004 (P6): subscribe to a session's event bus and project each `SPAN_EVENTS.COMPLETED`
 * event into a record span entry (via {@link createSpanEntry}). The interactive turn drains the
 * collected entries onto `history` at the turn boundary — BEFORE the turn's `usage-summary` entry —
 * so the read-model groups them under the owning turn. Tools publish raw (unbound) local event names,
 * so we match `SPAN_EVENTS.COMPLETED` directly.
 */
export function collectSpanEntries(eventService: IEventService): ISpanCollector {
  const entries: IHistoryEntry<ISpanEntry>[] = [];
  const listener: TEventListener = (eventType, data) => {
    if (eventType !== SPAN_EVENTS.COMPLETED) return;
    entries.push(createSpanEntry(data as ISpanCompletionEventData));
  };
  eventService.subscribe(listener);
  return {
    entries,
    dispose: () => eventService.unsubscribe(listener),
  };
}

function extractTurnUsage(
  sessionHistory: TUniversalMessage[],
  historyBefore: number,
  contextState: IContextWindowState,
  modelId?: string,
): IUsageSnapshot | undefined {
  const turnMessages = sessionHistory.slice(historyBefore);
  let promptTokens = 0;
  let completionTokens = 0;
  let foundUsage = false;

  for (const message of turnMessages) {
    if (message.role !== 'assistant') continue;
    const usage = collectAssistantUsageMetadata(message);
    if (!usage) continue;
    foundUsage = true;
    promptTokens += usage.inputTokens;
    completionTokens += usage.outputTokens;
  }

  if (!foundUsage) return undefined;

  // SELFHOST-004: derive the turn's exact cost from the model-pricing SSOT (input/output split).
  // `undefined` when no model id is in scope or the model is unpriced → costStatus stays 'unknown'.
  const costUsd = modelId ? calculateModelCost(modelId, promptTokens, completionTokens) : undefined;

  return {
    kind: 'exact',
    scope: 'turn',
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    contextUsedTokens: contextState.usedTokens,
    contextMaxTokens: contextState.maxTokens,
    contextUsedPercentage: contextState.usedPercentage,
    costStatus: costUsd !== undefined ? 'exact' : 'unknown',
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

/** No-op terminal implementation used during async initialization. */
export const NOOP_TERMINAL = {
  write: (): void => {},
  writeLine: (): void => {},
  writeMarkdown: (): void => {},
  writeError: (): void => {},
  prompt: (): Promise<string> => Promise.resolve(''),
  select: (): Promise<number> => Promise.resolve(0),
  spinner: () => ({ stop: () => {}, update: () => {} }),
};
