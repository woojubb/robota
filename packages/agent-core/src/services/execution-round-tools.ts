import type {
  IAgentConfig,
  TExecutionEventCallback,
  TExecutionEventData,
} from '../interfaces/agent';
import type { IToolCall } from '../interfaces/messages';
import type { IToolExecutionBatchContext } from './tool-execution-service';
import type { ConversationStore } from '../managers/conversation-history-manager';
import { getModelContextWindow } from '../context/models';
import { type IExecutionRoundState } from './execution-types';
import type { IRoundDependencies } from './execution-round';
import {
  type IToolResultsOutcome,
  addToolResultsToHistory,
  isUnknownToolExecutionResult,
} from './execution-round-tool-results';
export type { IToolResultsOutcome } from './execution-round-tool-results';

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
): Promise<IToolResultsOutcome> {
  const { toolExecutionService, logger, eventEmitter } = deps;

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
    };
  });
  const toolContext: IToolExecutionBatchContext = {
    requests: toolRequests,
    mode: 'parallel',
    maxConcurrency: 5,
    continueOnError: true,
    signal,
  };

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
      parameters: request.parameters,
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

  roundState.toolsExecuted.push(
    ...toolSummary.results
      .filter((result) => !isUnknownToolExecutionResult(result))
      .map((r) => {
        if (!r.toolName || r.toolName.length === 0) {
          throw new Error('[EXECUTION] Tool result missing toolName');
        }
        return r.toolName;
      }),
  );

  const contextLimit = getModelContextWindow(config?.defaultModel?.model ?? '');
  const messageCountBeforeToolResults = conversationStore.getMessages().length;
  const toolResultsOutcome = addToolResultsToHistory(
    assistantToolCalls,
    toolSummary,
    conversationStore,
    currentRound,
    logger,
    { contextLimit, cumulativeInputTokens: roundState.cumulativeInputTokens },
  );
  const addedToolMessages = conversationStore.getMessages().slice(messageCountBeforeToolResults);
  addedToolMessages.forEach((message, offset) => {
    onExecutionEvent?.('tool_message_committed', {
      executionId,
      conversationId,
      round: currentRound,
      batchId,
      index: offset,
      message,
    } as TExecutionEventData);
    onExecutionEvent?.('history_mutation', {
      executionId,
      conversationId,
      round: currentRound,
      batchId,
      mutation: 'append_message',
      index: messageCountBeforeToolResults + offset,
      message,
    } as TExecutionEventData);
  });

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
