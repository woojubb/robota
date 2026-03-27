/**
 * Prompt execution helpers for InteractiveSession.
 *
 * Contains abort detection, tool-summary extraction, and session persistence utilities.
 */

import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IContextWindowState, TUniversalMessage } from '@robota-sdk/agent-core';
import type { SessionStore } from '@robota-sdk/agent-sessions';
import type { Session } from '@robota-sdk/agent-sessions';
import type { IExecutionResult, IToolSummary } from './types.js';

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
  return {
    response,
    history: interactiveHistory,
    toolSummaries,
    contextState,
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
  return {
    response: parts.join('\n\n'),
    history: interactiveHistory,
    toolSummaries,
    contextState,
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
