/**
 * Prompt turn execution for InteractiveSession.
 *
 * Standalone function that runs one prompt turn, using callbacks to access
 * InteractiveSession state without coupling to the class directly.
 */

import {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  messageToHistoryEntry,
} from '@robota-sdk/agent-core';

import {
  isAbortError,
  buildResult,
  buildInterruptedResult,
  createUsageSummaryEntry,
  collectSpanEntries,
  preparePromptInput,
} from './interactive-session-execution.js';
import { pushToolSummaryToHistory } from './interactive-session-streaming.js';
import { humanizeApiError } from '../utils/error-humanizer.js';

import type { IToolState, IExecutionResult } from './types.js';
import type { IContextReferenceItem } from '../context/context-reference-inventory.js';
import type { IPromptFileReferenceRecord } from '../context/prompt-file-references.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { Session } from '@robota-sdk/agent-session';

export interface IPromptTurnContext {
  /**
   * SELFHOST-008 P3: an EPHEMERAL per-turn system block (rendered recalled memory) to include in THIS
   * turn's model call only — passed through to `session.run` and never persisted. Absent ⇒ no injection.
   */
  ephemeralSystemContext?: string;
  getSession: () => Session;
  getCwd: () => string;
  getHistory: () => IHistoryEntry[];
  getContextReferences: () => readonly IContextReferenceItem[];
  getActiveTools: () => IToolState[];
  resetUsedMemoryReferences: () => void;
  recordContextReferenceUsage: (records: readonly IPromptFileReferenceRecord[]) => void;
  recordPromptContextReferences: (records: readonly IPromptFileReferenceRecord[]) => void;
  beginEditCheckpointTurn: (prompt: string) => Promise<void>;
  flushStreaming: () => void;
  clearStreaming: () => void;
  /** Accumulated streamed text of the in-flight turn (ERR-001: preserved on error). */
  getStreamingText: () => string;
  onComplete: (result: IExecutionResult) => void;
  onInterrupted: (result: IExecutionResult) => void;
  onError: (err: Error) => void;
  onContextUpdate: () => void;
  onWorkspaceUpdated: () => void;
}

export async function executePromptTurn(
  input: string,
  displayInput: string | undefined,
  rawInput: string | undefined,
  ctx: IPromptTurnContext,
): Promise<void> {
  const history = ctx.getHistory();
  history.push(messageToHistoryEntry(createUserMessage(displayInput ?? input)));
  ctx.onWorkspaceUpdated();
  const historyBefore = ctx.getSession().getHistory().length;
  ctx.resetUsedMemoryReferences();

  // SELFHOST-004 (P6): collect the per-operation span events tools emit during this turn's run, so
  // they can be projected onto history under the owning turn (drained just before its usage-summary).
  const spanCollector = collectSpanEntries(ctx.getSession().getEventService());

  try {
    const preparedPrompt = await preparePromptInput(
      input,
      ctx.getCwd(),
      rawInput,
      ctx.getContextReferences(),
    );
    if (preparedPrompt.promptFileReferenceEntry) {
      history.push(preparedPrompt.promptFileReferenceEntry);
    }
    ctx.recordContextReferenceUsage(preparedPrompt.activeContextReferenceRecords);
    ctx.recordPromptContextReferences(preparedPrompt.promptFileReferenceRecords);

    await ctx.beginEditCheckpointTurn(displayInput ?? input);
    // SELFHOST-008 P3: pass the ephemeral recall block only when present, preserving the 2-arg call shape
    // for the (dominant) no-recall path so existing run() call contracts are unchanged.
    const response =
      ctx.ephemeralSystemContext !== undefined
        ? await ctx.getSession().run(preparedPrompt.modelInput, preparedPrompt.hookInput, {
            ephemeralSystemContext: ctx.ephemeralSystemContext,
          })
        : await ctx.getSession().run(preparedPrompt.modelInput, preparedPrompt.hookInput);
    ctx.flushStreaming();
    pushToolSummaryToHistory({ activeTools: ctx.getActiveTools(), history });
    ctx.clearStreaming();
    const result = buildResult(
      response || '(empty response)',
      ctx.getSession().getHistory(),
      history,
      historyBefore,
      ctx.getSession().getContextState(),
      preparedPrompt.promptFileReferenceRecords,
      ctx.getSession().getModelId(),
    );
    history.push(messageToHistoryEntry(createAssistantMessage(result.response)));
    // SELFHOST-004: drain the turn's spans immediately BEFORE its usage-summary — the usage-summary is
    // the reducer's turn boundary, so spans are recorded ONLY when that boundary exists. Pairing them
    // avoids attributing this turn's spans to a later turn's usage-summary (a usage-less turn drops
    // them rather than misgroup them).
    if (result.usage) {
      for (const spanEntry of spanCollector.entries) history.push(spanEntry);
      history.push(createUsageSummaryEntry(result.usage));
    }
    ctx.onComplete(result);
    ctx.onContextUpdate();
  } catch (err) {
    ctx.flushStreaming();
    if (isAbortError(err)) {
      const result = buildInterruptedResult(
        ctx.getSession().getHistory(),
        history,
        historyBefore,
        ctx.getSession().getContextState(),
        ctx.getSession().getModelId(),
      );
      pushToolSummaryToHistory({ activeTools: ctx.getActiveTools(), history });
      ctx.clearStreaming();
      if (result.response)
        history.push(messageToHistoryEntry(createAssistantMessage(result.response)));
      // SELFHOST-004: spans before the interrupt belong to this (final) turn — pair them with the
      // usage-summary boundary (drop them if this interrupted turn carries no usage, same as above).
      if (result.usage) {
        for (const spanEntry of spanCollector.entries) history.push(spanEntry);
        history.push(createUsageSummaryEntry(result.usage));
      }
      history.push(messageToHistoryEntry(createSystemMessage('Interrupted by user.')));
      ctx.onInterrupted(result);
    } else {
      pushToolSummaryToHistory({ activeTools: ctx.getActiveTools(), history });
      // ERR-001: a mid-stream failure must not evaporate the partial answer — commit it
      // to history marked interrupted before clearing the stream buffer.
      const partial = ctx.getStreamingText();
      ctx.clearStreaming();
      if (partial.trim().length > 0) {
        const partialMessage = createAssistantMessage(partial);
        partialMessage.state = 'interrupted';
        history.push(messageToHistoryEntry(partialMessage));
      }
      const errObj = err instanceof Error ? err : new Error(String(err));
      const errMsg = humanizeApiError(errObj);
      // metadata.kind lets transports render a styled error block instead of a plain system note.
      history.push(
        messageToHistoryEntry(
          createSystemMessage(`Error: ${errMsg}`, { metadata: { kind: 'error' } }),
        ),
      );
      ctx.onError(errObj);
    }
  } finally {
    // SELFHOST-004: always unsubscribe the span collector so a completed turn leaves no listener.
    spanCollector.dispose();
  }
}
