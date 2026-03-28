import type { IEventService, IEventContext } from '../interfaces/event-service';
import { bindWithOwnerPath } from '../event-service/index';
import { EXECUTION_EVENTS } from './execution-constants';
import {
  countWords,
  PREVIEW_LENGTH,
  CONTENT_PREVIEW_LENGTH,
  WORDS_PER_MINUTE,
  HIGH_COMPLEXITY_THRESHOLD,
  MEDIUM_COMPLEXITY_THRESHOLD,
  HIGH_INPUT_COMPLEXITY_THRESHOLD,
  MEDIUM_INPUT_COMPLEXITY_THRESHOLD,
} from './execution-types';
import type { IAgentConfig } from '../interfaces/agent';
import type { TUniversalMessage } from '../interfaces/messages';
import type { IResolvedProviderInfo } from './execution-types';
import type { ExecutionEventEmitter } from './execution-event-emitter';

/**
 * Emit the EXECUTION START event.
 * Extracted from ExecutionEventEmitter to reduce file size.
 */
export function emitExecutionStartEvent(
  emitter: ExecutionEventEmitter,
  input: string,
  config: IAgentConfig,
  messages: TUniversalMessage[],
  resolved: IResolvedProviderInfo,
  conversationId: string,
  executionId: string,
): void {
  emitter.emitExecution(
    EXECUTION_EVENTS.START,
    {
      parameters: {
        input,
        agentConfiguration: resolved.aiProviderInfo,
        availableTools: resolved.toolsInfo,
        toolCount: resolved.toolsInfo.length,
        hasTools: resolved.toolsInfo.length > 0,
        systemMessage: config.defaultModel.systemMessage,
        provider: config.defaultModel.provider,
        model: config.defaultModel.model,
        temperature: config.defaultModel.temperature,
        maxTokens: config.defaultModel.maxTokens,
      },
      metadata: {
        method: 'execute',
        inputLength: input.length,
        messageCount: messages.length,
        aiProvider: resolved.aiProviderInfo.providerName,
        model: resolved.aiProviderInfo.model,
        toolsAvailable: resolved.toolsInfo.map((t) => t.name),
        agentCapabilities: {
          canUseTools: resolved.toolsInfo.length > 0,
          supportedActions: resolved.toolsInfo.map((t) => t.name),
        },
      },
    },
    conversationId,
    executionId,
  );
}

/**
 * Emit the USER_MESSAGE event.
 * Extracted from ExecutionEventEmitter to reduce file size.
 */
export function emitUserMessageEvent(
  emitter: ExecutionEventEmitter,
  input: string,
  conversationId: string,
  executionId: string,
): void {
  emitter.emitExecution(
    EXECUTION_EVENTS.USER_MESSAGE,
    {
      parameters: {
        input,
        userPrompt: input,
        userMessageContent: input,
        messageLength: input.length,
        wordCount: countWords(input),
        characterCount: input.length,
      },
      metadata: {
        messageRole: 'user',
        inputLength: input.length,
        messageType: 'user_message',
        hasQuestions: input.includes('?'),
        containsUrgency: /urgent|asap|critical|emergency/i.test(input),
        estimatedComplexity:
          input.length > HIGH_INPUT_COMPLEXITY_THRESHOLD
            ? 'high'
            : input.length > MEDIUM_INPUT_COMPLEXITY_THRESHOLD
              ? 'medium'
              : 'low',
      },
    },
    conversationId,
    executionId,
  );
}

/**
 * Emit the ASSISTANT_MESSAGE_COMPLETE event.
 * Extracted from ExecutionEventEmitter to reduce file size.
 */
export function emitAssistantMessageComplete(
  emitter: ExecutionEventEmitter,
  baseEventService: IEventService,
  assistantResponse: { content?: string | null; timestamp?: Date },
  executionId: string,
  currentRound: number,
  conversationId: string,
  thinkingNodeId: string,
  previousThinkingNodeId: string | undefined,
): void {
  if (typeof assistantResponse.content !== 'string' || assistantResponse.content.length === 0) {
    throw new Error('[EXECUTION] assistant response must have content or tool calls');
  }
  if (!(assistantResponse.timestamp instanceof Date)) {
    throw new Error('[EXECUTION] assistant response timestamp is required');
  }
  const responseContent = assistantResponse.content;
  const responseStartTime = assistantResponse.timestamp;
  const responseDuration = new Date().getTime() - responseStartTime.getTime();

  emitter.emitWithContext(
    EXECUTION_EVENTS.ASSISTANT_MESSAGE_COMPLETE,
    {
      parameters: {
        assistantMessage: responseContent,
        responseLength: responseContent.length,
        wordCount: countWords(responseContent),
        responseTime: responseDuration,
        contentPreview:
          responseContent.length > CONTENT_PREVIEW_LENGTH
            ? responseContent.substring(0, CONTENT_PREVIEW_LENGTH) + '...'
            : responseContent,
      },
      result: {
        success: true,
        data: responseContent.substring(0, PREVIEW_LENGTH) + '...',
        fullResponse: responseContent,
        responseMetrics: {
          length: responseContent.length,
          estimatedReadTime: Math.ceil(countWords(responseContent) / WORDS_PER_MINUTE),
          hasCodeBlocks: /```/.test(responseContent),
          hasLinks: /https?:\/\//.test(responseContent),
          complexity:
            responseContent.length > HIGH_COMPLEXITY_THRESHOLD
              ? 'high'
              : responseContent.length > MEDIUM_COMPLEXITY_THRESHOLD
                ? 'medium'
                : 'low',
        },
      },
      metadata: {
        executionId,
        round: currentRound,
        completed: true,
        reason: 'no_tool_calls',
        responseCharacteristics: {
          hasQuestions: responseContent.includes('?'),
          isError: /error|fail|wrong/i.test(responseContent),
          isComplete: /complete|done|finish/i.test(responseContent),
          containsNumbers: /\d/.test(responseContent),
        },
      },
    },
    () =>
      emitter.buildResponseOwnerContext(
        conversationId,
        executionId,
        thinkingNodeId,
        previousThinkingNodeId,
      ),
    (ctx) => {
      if (!ctx.ownerType || !ctx.ownerId) {
        throw new Error('[EXECUTION] Missing owner context for response event');
      }
      return bindWithOwnerPath(baseEventService, {
        ownerType: ctx.ownerType,
        ownerId: ctx.ownerId,
        ownerPath: ctx.ownerPath,
      });
    },
  );
}

/**
 * Emit TOOL_RESULTS_READY and TOOL_RESULTS_TO_LLM events.
 * Extracted from ExecutionEventEmitter to reduce file size.
 */
export function emitToolResultsEvents(
  emitter: ExecutionEventEmitter,
  baseEventService: IEventService,
  assistantToolCalls: Array<{ id?: string }>,
  toolSummary: { results: Array<{ toolName?: string }> },
  toolsExecuted: string[],
  conversationId: string,
  executionId: string,
  currentRound: number,
  thinkingNodeId: string,
  previousThinkingNodeId: string | undefined,
): void {
  const toolCallIds = assistantToolCalls.map((toolCall) => {
    if (!toolCall.id || toolCall.id.length === 0) {
      throw new Error('[EXECUTION] Tool call missing id for tool results ready payload');
    }
    return toolCall.id;
  });
  if (toolCallIds.length === 0) {
    throw new Error('[EXECUTION] Tool results ready requires toolCallIds');
  }

  const buildCtx = () =>
    emitter.buildThinkingOwnerContext(
      conversationId,
      executionId,
      thinkingNodeId,
      previousThinkingNodeId,
    );
  const resolveService = (ctx: IEventContext) => {
    if (!ctx.ownerType || !ctx.ownerId) {
      throw new Error('[EXECUTION] Missing owner context for tool results event');
    }
    return bindWithOwnerPath(baseEventService, {
      ownerType: ctx.ownerType,
      ownerId: ctx.ownerId,
      ownerPath: ctx.ownerPath,
    });
  };

  emitter.emitWithContext(
    EXECUTION_EVENTS.TOOL_RESULTS_READY,
    {
      parameters: { toolCallIds, round: currentRound },
      metadata: { round: currentRound },
    },
    buildCtx,
    resolveService,
  );

  emitter.emitWithContext(
    EXECUTION_EVENTS.TOOL_RESULTS_TO_LLM,
    {
      parameters: {
        toolsExecuted: toolsExecuted.length,
        round: currentRound,
      },
      metadata: {
        toolsExecuted: toolSummary.results.map((r) => {
          if (!r.toolName || (r.toolName as string).length === 0) {
            throw new Error('[EXECUTION] Tool result missing toolName');
          }
          return r.toolName;
        }),
        round: currentRound,
      },
    },
    buildCtx,
    resolveService,
  );
}
