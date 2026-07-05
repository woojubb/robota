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
    const response = await ctx
      .getSession()
      .run(preparedPrompt.modelInput, preparedPrompt.hookInput);
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
    );
    history.push(messageToHistoryEntry(createAssistantMessage(result.response)));
    if (result.usage) history.push(createUsageSummaryEntry(result.usage));
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
      );
      pushToolSummaryToHistory({ activeTools: ctx.getActiveTools(), history });
      ctx.clearStreaming();
      if (result.response)
        history.push(messageToHistoryEntry(createAssistantMessage(result.response)));
      if (result.usage) history.push(createUsageSummaryEntry(result.usage));
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
  }
}
