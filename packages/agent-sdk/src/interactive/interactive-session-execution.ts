/**
 * Prompt execution helpers for InteractiveSession.
 *
 * Contains abort detection, tool-summary extraction, and prompt preparation utilities.
 */

import { randomUUID } from 'node:crypto';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IContextWindowState, TUniversalMessage } from '@robota-sdk/agent-core';
import { collectAssistantUsageMetadata } from '@robota-sdk/agent-core';
import type { IExecutionResult, IToolSummary, IUsageSnapshot } from './types.js';
import type { IContextReferenceItem } from '../context/context-reference-inventory.js';
import { listActiveContextReferences } from '../context/context-reference-inventory.js';
import type { IPromptFileReferenceRecord } from '../context/prompt-file-references.js';
import {
  buildPromptWithFileReferences,
  createPromptFileReferenceHistoryEntry,
  formatPromptFileReferenceDiagnostics,
  hasBlockingPromptFileReferenceDiagnostics,
  resolvePromptFileReferences,
  resolvePromptFileReferencePaths,
  toPromptFileReferenceRecords,
} from '../context/prompt-file-references.js';

export interface IPreparedPromptInput {
  modelInput: string;
  hookInput?: string;
  promptFileReferenceRecords: IPromptFileReferenceRecord[];
  activeContextReferenceRecords: IPromptFileReferenceRecord[];
  promptFileReferenceEntry?: IHistoryEntry;
}

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
  promptFileReferences?: readonly IPromptFileReferenceRecord[],
): IExecutionResult {
  const toolSummaries = extractToolSummaries(sessionHistory, historyBefore);
  const usage = extractTurnUsage(sessionHistory, historyBefore, contextState);
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

export async function preparePromptInput(
  input: string,
  cwd: string,
  rawInput?: string,
  contextReferences: readonly IContextReferenceItem[] = [],
): Promise<IPreparedPromptInput> {
  const activeReferenceResult = await resolvePromptFileReferencePaths(
    listActiveContextReferences(contextReferences).map((reference) => reference.sourcePath),
    { cwd, reason: 'manual' },
  );
  const promptFileReferenceResult = await resolvePromptFileReferences(input, { cwd });
  const diagnostics = [
    ...activeReferenceResult.diagnostics,
    ...promptFileReferenceResult.diagnostics,
  ];
  if (hasBlockingPromptFileReferenceDiagnostics(diagnostics)) {
    throw new Error(formatPromptFileReferenceDiagnostics(diagnostics));
  }

  const resolvedReferences = dedupeResolvedReferences([
    ...activeReferenceResult.references,
    ...promptFileReferenceResult.references,
  ]);
  const modelInput = buildPromptWithFileReferences(input, resolvedReferences);
  const hookInput = rawInput ?? (modelInput === input ? undefined : input);
  const activeContextReferenceRecords = toPromptFileReferenceRecords(
    activeReferenceResult.references,
  );
  const promptFileReferenceRecords = toPromptFileReferenceRecords(
    promptFileReferenceResult.references,
  );
  const promptFileReferenceEntry =
    promptFileReferenceResult.references.length > 0
      ? createPromptFileReferenceHistoryEntry(promptFileReferenceResult.references)
      : undefined;

  return {
    modelInput,
    ...(hookInput !== undefined ? { hookInput } : {}),
    activeContextReferenceRecords,
    promptFileReferenceRecords,
    ...(promptFileReferenceEntry !== undefined ? { promptFileReferenceEntry } : {}),
  };
}

function dedupeResolvedReferences(
  references: readonly (IPromptFileReferenceRecord & { content: string })[],
): Array<IPromptFileReferenceRecord & { content: string }> {
  return [...new Map(references.map((reference) => [reference.sourcePath, reference])).values()];
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
