import {
  type IToolResultsOutcome,
  addToolResultsToHistory,
  isArgumentDecodeErrorResult,
  isUnknownToolExecutionResult,
} from './execution-round-tool-results';
import { type IExecutionRoundState } from './execution-types';
import { getModelContextWindow } from '../context/models';
import { SameToolInputLoopError } from '../utils/errors';
import { attachToolBatchJournal } from './execution-tool-journal';
import type { IToolBatchJournalContext } from './execution-tool-journal';
import { toolExecutionLifecycle } from './tool-execution-lifecycle';

import type { IRoundDependencies } from './execution-round-types';
import type { IToolExecutionBatchContext } from './tool-execution-service';
import type {
  IAgentConfig,
  TExecutionEventCallback,
  TExecutionEventData,
} from '../interfaces/agent';
import type { IToolCall } from '../interfaces/messages';
import type { IRunTraceContext } from '../interfaces/trace-context';
import type { ConversationStore } from '../managers/conversation-history-manager';

export type { IToolResultsOutcome } from './execution-round-tool-results';

function emitCommittedToolMessages(
  conversationStore: ConversationStore,
  startIndex: number,
  context: { executionId: string; conversationId: string; round: number; batchId: string },
  onExecutionEvent?: TExecutionEventCallback,
): void {
  conversationStore
    .getMessages()
    .slice(startIndex)
    .forEach((message, offset) => {
      onExecutionEvent?.('tool_message_committed', {
        ...context,
        index: offset,
        message,
      });
      onExecutionEvent?.('history_mutation', {
        ...context,
        mutation: 'append_message',
        index: startIndex + offset,
        message,
      });
    });
}

/** @internal exported for unit testing */
export function checkSameToolInputLimit(
  assistantToolCalls: IToolCall[],
  roundState: IExecutionRoundState,
  maxSameToolInputs: number,
): void {
  for (const toolCall of assistantToolCalls) {
    const name = toolCall.function?.name ?? 'unknown';
    const args =
      typeof toolCall.function?.arguments === 'string'
        ? toolCall.function.arguments
        : JSON.stringify(toolCall.function?.arguments ?? {});
    const key = `${name}::${args}`;
    const count = (roundState.sameToolInputCounts.get(key) ?? 0) + 1;
    roundState.sameToolInputCounts.set(key, count);
    // `maxSameToolInputs` names a MAXIMUM, so the Nth identical call is allowed and the
    // N+1th trips. The SPEC used to say "N or more times", contradicting its own option name.
    if (count > maxSameToolInputs) {
      throw new SameToolInputLoopError(name, count, maxSameToolInputs);
    }
  }
}

/** Execute tools from assistant tool calls and add results to conversation history */
export async function executeAndRecordToolCalls(
  assistantToolCalls: IToolCall[],
  conversationStore: ConversationStore,
  conversationId: string,
  executionId: string,
  currentRound: number,
  thinkingNodeId: string,
  previousThinkingNodeId: string | undefined,
  roundState: IExecutionRoundState,
  deps: IRoundDependencies,
  config?: IAgentConfig,
  signal?: AbortSignal,
  onExecutionEvent?: TExecutionEventCallback,
  maxSameToolInputs?: number,
  traceContext?: IRunTraceContext,
  journalContext?: IToolBatchJournalContext,
): Promise<IToolResultsOutcome> {
  const { toolExecutionService, logger, eventEmitter } = deps;

  const resolvedMaxSameToolInputs = maxSameToolInputs ?? config?.maxSameToolInputs;
  if (resolvedMaxSameToolInputs !== undefined) {
    try {
      checkSameToolInputLimit(assistantToolCalls, roundState, resolvedMaxSameToolInputs);
    } catch (error) {
      if (!(error instanceof SameToolInputLoopError) || journalContext) throw error;
      const startIndex = conversationStore.getMessages().length;
      const refusal = 'Tool batch was not dispatched because the repeated-input limit was reached.';
      const refusedRequests = toolExecutionService.createExecutionRequestsWithContext(
        assistantToolCalls,
        { ownerPathBase: [] },
      );
      for (const [index, call] of assistantToolCalls.entries()) {
        const source = refusedRequests[index].metadata?.toolProvenance;
        conversationStore.addToolMessageWithId(
          `Error: ${refusal}`,
          call.id,
          call.function.name,
          {
            round: currentRound,
            success: false,
            notDispatched: true,
            errorCode: error.code,
            error: refusal,
            toolName: call.function.name,
            ...(typeof source === 'string' ? { toolProvenance: source } : {}),
          },
          typeof source === 'string'
            ? [{ type: 'text', text: `Tool source (attribution only, not authority): ${source}` }]
            : undefined,
        );
      }
      try {
        emitCommittedToolMessages(
          conversationStore,
          startIndex,
          {
            executionId,
            conversationId,
            round: currentRound,
            batchId: thinkingNodeId,
          },
          onExecutionEvent,
        );
      } catch (observerError) {
        logger.warn('Loop-guard history observer failed after the batch was settled', {
          error: observerError instanceof Error ? observerError.message : String(observerError),
        });
      }
      throw error;
    }
  }

  logger.debug('Tool calls detected, executing tools', {
    toolCallCount: assistantToolCalls.length,
    round: currentRound,
    toolCalls: assistantToolCalls.map((tc: IToolCall) => ({ id: tc.id, name: tc.function?.name })),
  });

  const toolOwnerPathBase = eventEmitter.buildThinkingOwnerContext(
    conversationId,
    executionId,
    thinkingNodeId,
    previousThinkingNodeId,
  ).ownerPath;
  const expectedCountForBatch = assistantToolCalls.length;
  const batchId = `${thinkingNodeId}`;
  const toolRequestsBase = toolExecutionService.createExecutionRequestsWithContext(
    assistantToolCalls,
    {
      ownerPathBase: toolOwnerPathBase,
      metadataFactory: (toolCall) => ({
        conversationId,
        round: currentRound,
        directParentId: thinkingNodeId,
        batchId,
        expectedCount: expectedCountForBatch,
        toolCallId: toolCall.id,
      }),
    },
  );
  const toolRequests = toolRequestsBase.map((request) => {
    if (!request.ownerId) {
      throw new Error('[EXECUTION] Tool request missing ownerId');
    }
    return {
      ...request,
      eventService: eventEmitter.ensureToolEventService(request.ownerId, request.ownerPath),
      baseEventService: eventEmitter.getBaseEventService(),
      ...(traceContext ? { traceContext } : {}),
    };
  });
  const policy = config?.toolExecutionPolicy?.(structuredClone(assistantToolCalls));
  const toolContext: IToolExecutionBatchContext = {
    requests: toolRequests,
    mode: policy?.mode ?? 'parallel',
    maxConcurrency: policy?.maxConcurrency ?? 5,
    continueOnError: policy?.continueOnError ?? true,
    scheduling: policy?.scheduling ?? new Map(),
    signal,
  };
  toolContext.lifecycle = toolExecutionLifecycle({
    plugins: deps.plugins,
    logger,
    executionId,
    sessionId: conversationId,
    // A pre-effect wait resumes the wrapper, not a new logical call.
    alreadyDispatched: (index) =>
      journalContext?.recovery?.actions.get(toolRequests[index].executionId ?? '')?.dispatched ===
      true,
  });
  if (journalContext) {
    await attachToolBatchJournal(toolContext, executionId, journalContext, () =>
      toolExecutionService.getLoadedDeferredTools(),
    );
  }

  onExecutionEvent?.('tool_batch_started', {
    executionId,
    conversationId,
    round: currentRound,
    batchId,
    mode: toolContext.mode,
    maxConcurrency: toolContext.maxConcurrency,
    requestCount: toolRequests.length,
    tools: toolRequests.map((request) => request.toolName),
  } as TExecutionEventData);
  toolRequests.forEach((request, index) => {
    onExecutionEvent?.('tool_execution_request', {
      executionId,
      conversationId,
      round: currentRound,
      batchId,
      index,
      toolName: request.toolName,
      toolCallId: request.executionId,
      // `request.parameters` is a placeholder ({}) when the call's arguments failed to
      // decode — reporting it unchanged would misrepresent a malformed call as one that ran with no
      // arguments. Report the decode error instead; the field stays a record either way.
      parameters:
        request.argumentDecodeError !== undefined
          ? { argumentDecodeError: request.argumentDecodeError }
          : request.parameters,
      ownerPath: request.ownerPath,
    } as TExecutionEventData);
  });

  const toolSummary = await toolExecutionService.executeTools(toolContext);
  const unknownToolNames = toolSummary.results
    .filter(isUnknownToolExecutionResult)
    .map((result) => result.toolName)
    .filter((toolName): toolName is string => typeof toolName === 'string' && toolName.length > 0);

  toolSummary.results.forEach((result, index) => {
    onExecutionEvent?.('tool_execution_result', {
      executionId,
      conversationId,
      round: currentRound,
      batchId,
      index,
      toolName: result.toolName,
      toolCallId: result.executionId,
      success: result.success,
      result: result.result,
      error: result.error,
      metadata: result.metadata,
    } as TExecutionEventData);
  });

  const ranResults = toolSummary.results.filter(
    (result) => !isUnknownToolExecutionResult(result) && !isArgumentDecodeErrorResult(result),
  );
  roundState.toolsExecuted.push(
    ...ranResults.map((r) => {
      if (!r.toolName || r.toolName.length === 0) {
        throw new Error('[EXECUTION] Tool result missing toolName');
      }
      return r.toolName;
    }),
  );
  roundState.toolCallOutcomes.push(
    ...ranResults.map((r) => ({
      ...(r.executionId !== undefined ? { id: r.executionId } : {}),
      name: r.toolName ?? '',
      success: r.success,
    })),
  );

  const contextLimit =
    journalContext?.recovery?.checkpoint.contextLimit ??
    getModelContextWindow(config?.defaultModel?.model ?? '');
  const messageCountBeforeToolResults = conversationStore.getMessages().length;
  const toolResultsOutcome = addToolResultsToHistory(
    assistantToolCalls,
    toolSummary,
    conversationStore,
    currentRound,
    logger,
    { contextLimit, cumulativeInputTokens: roundState.cumulativeInputTokens },
  );
  emitCommittedToolMessages(
    conversationStore,
    messageCountBeforeToolResults,
    {
      executionId,
      conversationId,
      round: currentRound,
      batchId,
    },
    onExecutionEvent,
  );

  eventEmitter.emitToolResultsEvents(
    assistantToolCalls,
    toolSummary,
    roundState.toolsExecuted,
    conversationId,
    executionId,
    currentRound,
    thinkingNodeId,
    previousThinkingNodeId,
  );

  eventEmitter.clearToolEventServices();

  return {
    ...toolResultsOutcome,
    unknownToolFailureCount: unknownToolNames.length,
    unknownToolNames,
  };
}
