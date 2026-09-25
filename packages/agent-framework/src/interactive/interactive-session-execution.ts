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
  PROVIDER_CALL_EVENTS,
  PROVIDER_FALLBACK_EVENTS,
  TOOL_BODY_EVENTS,
  TOOL_PERMISSION_EVENTS,
} from '@robota-sdk/agent-core';

import type { IExecutionResult, IToolSummary, IUsageSnapshot } from './types.js';
import type { IPromptFileReferenceRecord } from '../context/prompt-file-references.js';
import type {
  IContextWindowState,
  IModelFallbackNotice,
  ITokenUsage,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import type {
  IHistoryEntry,
  ISpanCompletionEventData,
  IEventService,
  TEventListener,
} from '@robota-sdk/agent-core';
import type { IUsageSource, ISpanEntry } from '@robota-sdk/agent-interface-analytics';
import type { IProviderCallTraceObservation } from '@robota-sdk/agent-session';

export { createUsageObservationEntry } from './interactive-session-usage-observation.js';

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
  providerCalls: readonly IProviderCallTraceObservation[] = [],
): IExecutionResult {
  const toolSummaries = extractToolSummaries(sessionHistory, historyBefore);
  const usage = extractTurnUsage(sessionHistory, historyBefore, contextState, providerCalls);
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
  providerCalls: readonly IProviderCallTraceObservation[] = [],
): IExecutionResult {
  const toolSummaries = extractToolSummaries(sessionHistory, historyBefore);
  const parts: string[] = [];
  for (let i = historyBefore; i < sessionHistory.length; i++) {
    const msg = sessionHistory[i];
    if (msg?.role === 'assistant' && msg.content) parts.push(msg.content);
  }
  const usage = extractTurnUsage(sessionHistory, historyBefore, contextState, providerCalls);
  return {
    response: parts.join('\n\n'),
    interrupted: true,
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

/**
 * A provider-call observation as read off the bus, before live-projection validation.
 * `providerRequestId` is a raw event value — the live projection (`projectProvider`) validates it
 * before export, the same way `IToolBodyTraceObservation.toolCallId` stays raw here.
 */
export type TRawProviderCallTraceObservation = Omit<IProviderCallTraceObservation, 'providerRequestId'> & {
  readonly providerRequestId?: unknown;
};

/** A live span collector: buffers span entries seen on the bus until disposed. */
export interface ISpanCollector {
  /** The span entries observed since subscription, in emit order. */
  readonly entries: IHistoryEntry<ISpanEntry>[];
  readonly providerCalls: IProviderCallTraceObservation[];
  readonly toolBodies: IToolBodyTraceObservation[];
  readonly completions: (
    | { readonly kind: 'provider'; readonly observation: TRawProviderCallTraceObservation }
    | { readonly kind: 'tool'; readonly observation: IToolBodyTraceObservation }
    | { readonly kind: 'permission'; readonly observation: IToolPermissionDecisionObservation }
  )[];
  readonly omittedCompletions: { provider: number; tool: number; permission: number };
  /** Unsubscribe from the bus (idempotent). */
  dispose(): void;
}

export interface IToolBodyTraceObservation {
  /** Raw event value; live projection validates before export. */
  readonly toolCallId?: unknown;
  /** The body ID core minted; the body's span is derived from it. Absent means no span to export. */
  readonly toolBodyId?: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly outcome: 'success' | 'failure' | 'interrupted';
}

export interface IToolPermissionDecisionObservation {
  /** Raw event value; live projection validates before export. */
  readonly toolCallId?: unknown;
  readonly decidedAt: string;
  readonly decision: 'allowed' | 'denied' | 'hook-blocked';
}

/**
 * SELFHOST-004 (P6): subscribe to a session's event bus and project each `SPAN_EVENTS.COMPLETED`
 * event into a record span entry (via {@link createSpanEntry}). The interactive turn drains the
 * collected entries onto `history` at the turn boundary — BEFORE the turn's `usage-summary` entry —
 * so the read-model groups them under the owning turn. Tools publish raw (unbound) local event names,
 * so we match `SPAN_EVENTS.COMPLETED` directly.
 */
/** How far one of this collector's own tool calls got, as its permission and body events said. */
export type TToolCallObservedPhase = 'allowed' | 'denied' | 'hook-blocked' | 'body-completed';

export interface ISpanCollectorOptions {
  /**
   * Called synchronously for every permission and tool-body event carrying a string call ID,
   * before any validation or cap: it tells the turn which calls are its own. A throwing observer
   * never affects collection.
   */
  readonly onToolCallObserved?: (toolCallId: string, phase: TToolCallObservedPhase) => void;
  /** Called when a request of this turn moved to another model. */
  readonly onProviderFallback?: (notice: IModelFallbackNotice) => void;
}

function readFallbackNotice(data: Record<string, unknown>): IModelFallbackNotice | undefined {
  const { fromProvider, fromModel, toProvider, toModel, reason } = data;
  if (
    typeof fromProvider !== 'string' ||
    typeof fromModel !== 'string' ||
    typeof toProvider !== 'string' ||
    typeof toModel !== 'string' ||
    typeof reason !== 'string'
  ) {
    return undefined;
  }
  return {
    from: { provider: fromProvider, model: fromModel },
    to: { provider: toProvider, model: toModel },
    reason: reason as IModelFallbackNotice['reason'],
  };
}

function observeToolCall(
  options: ISpanCollectorOptions,
  toolCallId: unknown,
  phase: unknown,
): void {
  if (typeof toolCallId !== 'string' || !options.onToolCallObserved) return;
  if (phase !== 'allowed' && phase !== 'denied' && phase !== 'hook-blocked' && phase !== 'body-completed') return;
  try {
    options.onToolCallObserved(toolCallId, phase);
  } catch {
    // An ownership observer must never change what the trace collects.
  }
}

export function collectSpanEntries(
  eventService: IEventService,
  options: ISpanCollectorOptions = {},
): ISpanCollector {
  const entries: IHistoryEntry<ISpanEntry>[] = [];
  const providerCalls: IProviderCallTraceObservation[] = [];
  const toolBodies: IToolBodyTraceObservation[] = [];
  const completions: ISpanCollector['completions'] = [];
  const omittedCompletions = { provider: 0, tool: 0, permission: 0 };
  const listener: TEventListener = (eventType, data) => {
    if (eventType === PROVIDER_FALLBACK_EVENTS.SWITCHED) {
      const notice = readFallbackNotice(data);
      if (notice !== undefined) options.onProviderFallback?.(notice);
      return;
    }
    if (eventType === `tool.${TOOL_PERMISSION_EVENTS.DECIDED}`) {
      observeToolCall(options, data['executionId'], data['decision']);
      if (
        typeof data['decidedAt'] === 'string' &&
        (data['decision'] === 'allowed' || data['decision'] === 'denied' || data['decision'] === 'hook-blocked')
      ) {
        const observation: IToolPermissionDecisionObservation = {
          ...(data['executionId'] !== undefined ? { toolCallId: data['executionId'] } : {}),
          decidedAt: data['decidedAt'],
          decision: data['decision'],
        };
        completions.push({ kind: 'permission', observation });
      } else {
        omittedCompletions.permission += 1;
      }
      return;
    }
    if (eventType === `tool.${TOOL_BODY_EVENTS.COMPLETED}`) {
      observeToolCall(options, data['executionId'], 'body-completed');
      if (
        typeof data['startedAt'] === 'string' &&
        typeof data['endedAt'] === 'string' &&
        (data['outcome'] === 'success' ||
          data['outcome'] === 'failure' ||
          data['outcome'] === 'interrupted')
      ) {
        const observation: IToolBodyTraceObservation = {
          ...(data['executionId'] !== undefined ? { toolCallId: data['executionId'] } : {}),
          ...(typeof data['toolBodyId'] === 'string' ? { toolBodyId: data['toolBodyId'] } : {}),
          startedAt: data['startedAt'],
          endedAt: data['endedAt'],
          outcome: data['outcome'],
        };
        toolBodies.push(observation);
        completions.push({ kind: 'tool', observation });
      } else {
        omittedCompletions.tool += 1;
      }
      return;
    }
    if (eventType === PROVIDER_CALL_EVENTS.COMPLETED) {
      if (
        typeof data['round'] === 'number' &&
        Number.isSafeInteger(data['round']) &&
        data['round'] > 0 &&
        typeof data['startedAt'] === 'string' &&
        typeof data['endedAt'] === 'string' &&
        (data['outcome'] === 'success' ||
          data['outcome'] === 'failure' ||
          data['outcome'] === 'interrupted')
      ) {
        const observation: TRawProviderCallTraceObservation = {
          round: data['round'],
          startedAt: data['startedAt'],
          endedAt: data['endedAt'],
          outcome: data['outcome'],
          ...(typeof data['callId'] === 'string' && { callId: data['callId'] }),
          ...((data['disposition'] === 'invoked' || data['disposition'] === 'cache-hit' || data['disposition'] === 'preflight-refused') &&
            { disposition: data['disposition'] }),
          ...(typeof data['providerId'] === 'string' && { providerId: data['providerId'] }),
          ...(typeof data['modelId'] === 'string' && { modelId: data['modelId'] }),
          ...((data['usageProvenance'] === 'complete' || data['usageProvenance'] === 'partial' || data['usageProvenance'] === 'absent') &&
            { usageProvenance: data['usageProvenance'] }),
          ...(typeof data['promptTokens'] === 'number' && typeof data['completionTokens'] === 'number' && typeof data['totalTokens'] === 'number' && {
            promptTokens: data['promptTokens'],
            completionTokens: data['completionTokens'],
            totalTokens: data['totalTokens'],
          }),
          ...(data['providerRequestId'] !== undefined && { providerRequestId: data['providerRequestId'] }),
        };
        // `providerCalls` feeds usage/cost extraction only, which never reads providerRequestId — kept
        // strictly typed rather than widened for a field it does not use.
        const { providerRequestId: _providerRequestId, ...usageObservation } = observation;
        providerCalls.push(usageObservation);
        completions.push({ kind: 'provider', observation });
      } else {
        omittedCompletions.provider += 1;
      }
      return;
    }
    if (eventType !== SPAN_EVENTS.COMPLETED) return;
    entries.push(createSpanEntry(data as ISpanCompletionEventData));
  };
  eventService.subscribe(listener);
  return {
    entries,
    providerCalls,
    toolBodies,
    completions,
    omittedCompletions,
    dispose: () => eventService.unsubscribe(listener),
  };
}

function extractTurnUsage(
  sessionHistory: TUniversalMessage[],
  historyBefore: number,
  contextState: IContextWindowState,
  providerCalls: readonly IProviderCallTraceObservation[] = [],
): IUsageSnapshot | undefined {
  const turnMessages = sessionHistory.slice(historyBefore);
  let promptTokens = 0;
  let completionTokens = 0;
  let foundUsage = false;
  const seenUsageFragments = new Set<string>();

  for (const message of turnMessages) {
    if (message.role !== 'assistant') continue;
    const observationId = message.metadata?.['usageObservationId'];
    const round = message.metadata?.['round'];
    const usageKey = typeof observationId === 'string'
      ? `${observationId}:${Number.isSafeInteger(round) ? round : 'legacy'}`
      : message.id;
    if (seenUsageFragments.has(usageKey)) continue;
    const usage = collectAssistantUsageMetadata(message);
    if (!usage) continue;
    seenUsageFragments.add(usageKey);
    foundUsage = true;
    promptTokens += usage.inputTokens;
    completionTokens += usage.outputTokens;
  }

  if (!foundUsage) return undefined;

  const verified = estimateVerifiedCallCost(providerCalls, promptTokens, completionTokens);
  const costUsd = verified.costUsd;

  return {
    kind: verified.tokensMatch ? 'exact' : 'estimated',
    scope: 'turn',
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    contextUsedTokens: contextState.usedTokens,
    contextMaxTokens: contextState.maxTokens,
    contextUsedPercentage: contextState.usedPercentage,
    costStatus: costUsd !== undefined ? 'estimated' : 'unknown',
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

function estimateVerifiedCallCost(
  calls: readonly IProviderCallTraceObservation[],
  promptTokens: number,
  completionTokens: number,
): { tokensMatch: boolean; costUsd?: number } {
  const seen = new Map<string, IProviderCallTraceObservation>();
  let input = 0;
  let output = 0;
  let cost = 0;
  let priced = true;
  let invoked = 0;
  for (const call of calls) {
    if (call.disposition !== 'invoked') continue;
    if (!call.callId) return { tokensMatch: false };
    const duplicate = seen.get(call.callId);
    if (duplicate) {
      if (JSON.stringify(duplicate) !== JSON.stringify(call)) return { tokensMatch: false };
      continue;
    }
    seen.set(call.callId, call);
    invoked += 1;
    if (
      call.usageProvenance !== 'complete' ||
      !Number.isSafeInteger(call.promptTokens) || (call.promptTokens ?? -1) < 0 ||
      !Number.isSafeInteger(call.completionTokens) || (call.completionTokens ?? -1) < 0 ||
      call.totalTokens !== (call.promptTokens ?? 0) + (call.completionTokens ?? 0)
    ) return { tokensMatch: false };
    input += call.promptTokens!;
    output += call.completionTokens!;
    const estimated = call.modelId
      ? calculateModelCost(call.modelId, call.promptTokens!, call.completionTokens!)
      : undefined;
    if (estimated === undefined || !Number.isFinite(estimated) || estimated < 0) priced = false;
    else cost += estimated;
  }
  const tokensMatch = invoked > 0 && input === promptTokens && output === completionTokens;
  return { tokensMatch, ...(tokensMatch && priced && { costUsd: cost }) };
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
