import {
  type IToolResultsOutcome,
  addToolResultsToHistory,
  isArgumentDecodeErrorResult,
  isUnknownToolExecutionResult,
} from './execution-round-tool-results';
import { type IExecutionRoundState } from './execution-types';
import { getModelContextWindow } from '../context/models';
import { SameToolInputLoopError } from '../utils/errors';
import { randomId } from '../utils/random-id';
import { appendExecutionRecord } from './execution-journal';
import type { IExecutionJournal } from '../interfaces/execution-journal';
import type { IRecoveredToolBatch } from './execution-recovery-state';
import { toolContinuation } from './execution-tool-waits';
import { callPluginHook } from './plugin-hook-dispatcher';

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
    // CORE-035: `maxSameToolInputs` names a MAXIMUM, so the Nth identical call is allowed and the
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
  journalContext?: {
    journal: IExecutionJournal;
    parentCallId: string;
    recovery?: IRecoveredToolBatch;
  },
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
  toolContext.lifecycle = {
    beforeDispatch: async (index, toolData) => {
      // A pre-effect wait resumes the wrapper, not a new logical call.
      const request = toolRequests[index];
      if (journalContext?.recovery?.actions.get(request.executionId ?? '')?.dispatched) return;
      const context = { toolData, executionContext: { executionId, sessionId: conversationId } };
      await callPluginHook(deps.plugins, 'beforeToolCall', context, logger);
      await callPluginHook(deps.plugins, 'beforeToolExecution', context, logger);
    },
    onResult: async (_index, toolData, toolResult) => {
      await callPluginHook(
        deps.plugins,
        'afterToolCall',
        {
          toolData,
          toolResult,
          executionContext: { executionId, sessionId: conversationId },
        },
        logger,
      );
    },
  };
  if (journalContext) {
    const { journal, parentCallId } = journalContext;
    const recovered = toolRequests.map((request) =>
      journalContext.recovery?.actions.get(request.executionId ?? ''),
    );
    const actions = toolRequests.map((request) => ({
      actionId:
        journalContext.recovery?.actions.get(request.executionId ?? '')?.actionId ?? randomId(),
      parentCallId,
      executionId,
      toolCallId: request.executionId ?? '',
      toolName: request.toolName,
    }));
    const continuations = actions.map((action, index) =>
      toolContinuation(journal, action, recovered[index]?.waits),
    );
    // Every decoded intent must be durable before ANY member of the batch is dispatched.
    for (let index = 0; index < toolRequests.length; index++) {
      const request = toolRequests[index];
      if (
        request.argumentDecodeError !== undefined ||
        recovered[index]?.intent ||
        recovered[index]?.result
      )
        continue;
      await appendExecutionRecord(journal, {
        kind: 'tool-intent',
        recordId: `${actions[index].actionId}:intent`,
        ...actions[index],
        parameters: request.parameters,
      });
    }
    toolContext.journal = {
      continuation: (index) => continuations[index].continuation,
      settle: (index) => continuations[index].settle(),
      beforeDispatch: (index) =>
        recovered[index]?.dispatched
          ? Promise.resolve()
          : appendExecutionRecord(journal, {
              kind: 'tool-dispatch',
              recordId: `${actions[index].actionId}:dispatch`,
              ...actions[index],
            }),
      onResult: (index, result) =>
        appendExecutionRecord(journal, {
          kind: 'tool-result',
          recordId: `${actions[index].actionId}:result`,
          ...actions[index],
          result,
          loadedDeferredTools: toolExecutionService.getLoadedDeferredTools(),
        }),
      beforeEffect: (index, parameters) =>
        continuations[index].admit(() =>
          appendExecutionRecord(journal, {
            kind: 'tool-effect-start',
            recordId: `${actions[index].actionId}:effect-start`,
            ...actions[index],
            parameters,
          }),
        ),
    };
    toolContext.recoveredResults = new Map(
      recovered.flatMap((action, index) =>
        action?.result ? [[index, action.result] as const] : [],
      ),
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
      // Issue #2875: `request.parameters` is a placeholder ({}) when the call's arguments failed to
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
