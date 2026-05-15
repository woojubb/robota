/**
 * Prompt turn execution for InteractiveSession.
 *
 * Standalone function that runs one prompt turn, using callbacks to access
 * InteractiveSession state without coupling to the class directly.
 */

import type { Session } from '@robota-sdk/agent-sessions';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
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
import type { IToolState, IExecutionResult } from './types.js';
import type { IContextReferenceItem } from '../context/context-reference-inventory.js';
import type { IPromptFileReferenceRecord } from '../context/prompt-file-references.js';

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
      ctx.clearStreaming();
      const errMsg = err instanceof Error ? err.message : String(err);
      history.push(messageToHistoryEntry(createSystemMessage(`Error: ${errMsg}`)));
      ctx.onError(err instanceof Error ? err : new Error(errMsg));
    }
  }
}
