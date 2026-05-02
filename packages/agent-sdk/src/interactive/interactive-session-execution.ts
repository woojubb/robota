/**
 * Prompt execution helpers for InteractiveSession.
 *
 * Contains abort detection, tool-summary extraction, and session persistence utilities.
 */

import { randomUUID } from 'node:crypto';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IContextWindowState, TUniversalMessage } from '@robota-sdk/agent-core';
import { collectAssistantUsageMetadata } from '@robota-sdk/agent-core';
import type { SessionStore } from '@robota-sdk/agent-sessions';
import type { Session } from '@robota-sdk/agent-sessions';
import type { IExecutionResult, IToolSummary, IUsageSnapshot } from './types.js';
import type {
  IBackgroundJobGroupState,
  IBackgroundTaskState,
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
} from '../background-tasks/index.js';
import type { IMemoryEvent, IMemoryReference } from '../memory/automatic-memory-types.js';

/** Detect whether an error represents an abort/cancel action. */
export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && (err.message.includes('aborted') || err.message.includes('abort')))
  );
}

/**
 * Extract tool call summaries from a session history slice.
 *
 * Scans history entries from `historyBefore` onwards and collects
 * tool call records from assistant messages.
 */
export function extractToolSummaries(
  history: TUniversalMessage[],
  historyBefore: number,
): IToolSummary[] {
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
): IExecutionResult {
  const toolSummaries = extractToolSummaries(sessionHistory, historyBefore);
  const usage = extractTurnUsage(sessionHistory, historyBefore, contextState);
  return {
    response,
    history: interactiveHistory,
    toolSummaries,
    contextState,
    ...(usage && { usage }),
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
): IExecutionResult {
  const toolSummaries = extractToolSummaries(sessionHistory, historyBefore);
  const parts: string[] = [];
  for (let i = historyBefore; i < sessionHistory.length; i++) {
    const msg = sessionHistory[i];
    if (msg?.role === 'assistant' && msg.content) parts.push(msg.content);
  }
  const usage = extractTurnUsage(sessionHistory, historyBefore, contextState);
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

function extractTurnUsage(
  sessionHistory: TUniversalMessage[],
  historyBefore: number,
  contextState: IContextWindowState,
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
  return {
    kind: 'exact',
    scope: 'turn',
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    contextUsedTokens: contextState.usedTokens,
    contextMaxTokens: contextState.maxTokens,
    contextUsedPercentage: contextState.usedPercentage,
    costStatus: 'unknown',
  };
}

/**
 * Persist the current session state to the session store.
 * Silently ignores errors (persist failure must not break execution).
 */
export function persistSession(
  sessionStore: SessionStore,
  session: Session,
  sessionName: string | undefined,
  cwd: string,
  history: IHistoryEntry[],
  backgroundState?: {
    tasks: readonly IBackgroundTaskState[];
    events: readonly TBackgroundTaskEvent[];
    groups?: readonly IBackgroundJobGroupState[];
    groupEvents?: readonly TBackgroundJobGroupEvent[];
  },
  memoryState?: {
    events: readonly IMemoryEvent[];
    usedReferences: readonly IMemoryReference[];
  },
): void {
  try {
    const sessionId = session.getSessionId();
    const existing = sessionStore.load(sessionId);
    sessionStore.save({
      id: sessionId,
      name: sessionName ?? existing?.name,
      cwd,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: session.getHistory(),
      history,
      systemPrompt: session.getSystemMessage(),
      toolSchemas: session.getToolSchemas(),
      ...(backgroundState
        ? {
            backgroundTasks: [...backgroundState.tasks],
            backgroundTaskEvents: [...backgroundState.events],
            backgroundJobGroups: [...(backgroundState.groups ?? [])],
            backgroundJobGroupEvents: [...(backgroundState.groupEvents ?? [])],
          }
        : {}),
      ...(memoryState
        ? {
            memoryEvents: [...memoryState.events],
            usedMemoryReferences: [...memoryState.usedReferences],
          }
        : {}),
    });
  } catch {
    // Persist failure should not break execution
  }
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
