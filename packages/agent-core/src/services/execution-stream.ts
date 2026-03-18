import type { IAgentConfig, IAssistantMessage } from '../interfaces/agent';
import type { IPluginContext, TMetadata } from '../interfaces/types';
import type { IAIProviderManager } from '../interfaces/manager';
import type { IToolManager } from '../interfaces/manager';
import type { IChatOptions } from '../interfaces/provider';
import type { IToolCall, TUniversalMessage } from '../interfaces/messages';
import type { IToolExecutionBatchContext } from './tool-execution-service';
import type { ToolExecutionService } from './tool-execution-service';
import type { ConversationHistory } from '../managers/conversation-history-manager';
import type { ILogger } from '../utils/logger';
import type { ExecutionEventEmitter } from './execution-event-emitter';
import type { TPluginWithHooks } from './plugin-hook-dispatcher';
import { callPluginHook } from './plugin-hook-dispatcher';
import { isExecutionError } from './execution-types';
import type { IExecutionContext, IExecutionError } from './execution-types';
import { EXECUTION_EVENTS } from './execution-constants';

/** Streaming chunk yielded by executeStream */
export interface IStreamChunk {
  chunk: string;
  isComplete: boolean;
}

/** Dependencies required by executeStream */
export interface IStreamDependencies {
  aiProviders: IAIProviderManager;
  tools: IToolManager;
  conversationHistory: ConversationHistory;
  toolExecutionService: ToolExecutionService;
  plugins: ReadonlyArray<TPluginWithHooks>;
  logger: ILogger;
  eventEmitter: ExecutionEventEmitter;
  generateExecutionId: () => string;
}

/**
 * Execute with streaming response.
 * Extracted from ExecutionService to reduce file size.
 */
export async function* executeStream(
  input: string,
  _messages: TUniversalMessage[],
  config: IAgentConfig,
  context: Partial<IExecutionContext> | undefined,
  deps: IStreamDependencies,
): AsyncGenerator<IStreamChunk> {
  const {
    aiProviders,
    tools,
    conversationHistory,
    toolExecutionService,
    plugins,
    logger,
    eventEmitter,
  } = deps;

  logger.debug('ExecutionService.executeStream called');

  const executionId = deps.generateExecutionId();
  const startTime = Date.now();
  if (!context?.conversationId || context.conversationId.length === 0) {
    throw new Error('[EXECUTION] conversationId is required for streaming');
  }
  const streamingConversationId = context.conversationId;
  eventEmitter.prepareOwnerPathBases(streamingConversationId);

  try {
    const conversationSession = conversationHistory.getConversationSession(context.conversationId);

    if (input) {
      conversationSession.addUserMessage(input, { executionId });
    }

    await callPluginHook(
      plugins,
      'beforeRun',
      {
        input,
        ...(context?.metadata ? { metadata: context.metadata as TMetadata } : {}),
      },
      logger,
    );

    const currentInfo = aiProviders.getCurrentProvider();
    if (!currentInfo) {
      throw new Error('No AI provider configured');
    }

    const provider = aiProviders.getProvider(currentInfo.provider);
    if (!provider) {
      throw new Error(`AI provider '${currentInfo.provider}' not found`);
    }

    if (typeof provider.chatStream !== 'function') {
      throw new Error('Provider must have chatStream method to support streaming execution');
    }

    logger.debug('ExecutionService calling provider.chatStream');

    const conversationMessages = conversationSession.getMessages();

    const configToolsLength = Array.isArray(config.tools) ? config.tools.length : undefined;
    logger.debug('[EXECUTION-SERVICE] config.tools:', {
      length: configToolsLength,
    });
    const toolSchemas = tools.getTools();
    const toolSchemasLength = Array.isArray(toolSchemas) ? toolSchemas.length : undefined;
    logger.debug('[EXECUTION-SERVICE] this.tools.getTools():', {
      length: toolSchemasLength,
    });
    logger.debug('[EXECUTION-SERVICE] config.tools exists:', {
      exists: !!config.tools,
    });
    logger.debug('[EXECUTION-SERVICE] config.tools.length > 0:', {
      hasTools: config.tools && config.tools.length > 0,
    });

    const chatOptions: IChatOptions = {
      model: config.defaultModel.model,
      ...(config.tools && config.tools.length > 0 && { tools: tools.getTools() }),
    };

    logger.debug('[EXECUTION-SERVICE] Final chatOptions has tools:', {
      hasTools: !!chatOptions.tools,
    });
    const chatOptionsToolsLength = Array.isArray(chatOptions.tools)
      ? chatOptions.tools.length
      : undefined;
    logger.debug('[EXECUTION-SERVICE] Final chatOptions.tools length:', {
      length: chatOptionsToolsLength,
    });

    const chatStream = provider.chatStream;
    if (!chatStream) {
      throw new Error('Provider does not support streaming');
    }

    const stream = chatStream.call(provider, conversationMessages, chatOptions);
    let fullResponse = '';
    let toolCalls: IToolCall[] = [];
    let currentToolCallIndex = -1;

    for await (const chunk of stream) {
      if (chunk.content) {
        fullResponse += chunk.content;
        yield { chunk: chunk.content, isComplete: false };
      }

      if (chunk.role === 'assistant') {
        const assistantChunk = chunk as IAssistantMessage;
        if (Array.isArray(assistantChunk.toolCalls) && assistantChunk.toolCalls.length > 0) {
          for (const chunkToolCall of assistantChunk.toolCalls) {
            if (chunkToolCall.id && chunkToolCall.id !== '') {
              if (!chunkToolCall.type || chunkToolCall.type.length === 0) {
                throw new Error(
                  `[EXECUTION] Tool call "${chunkToolCall.id}" missing type in stream`,
                );
              }
              if (!chunkToolCall.function?.name || chunkToolCall.function.name.length === 0) {
                throw new Error(
                  `[EXECUTION] Tool call "${chunkToolCall.id}" missing function name in stream`,
                );
              }
              if (typeof chunkToolCall.function.arguments !== 'string') {
                throw new Error(
                  `[EXECUTION] Tool call "${chunkToolCall.id}" missing arguments in stream`,
                );
              }
              currentToolCallIndex = toolCalls.length;
              toolCalls.push({
                id: chunkToolCall.id,
                type: chunkToolCall.type,
                function: {
                  name: chunkToolCall.function.name,
                  arguments: chunkToolCall.function.arguments,
                },
              });
              logger.debug(
                `[TOOL-STREAM] New tool call started: ${chunkToolCall.id} (${chunkToolCall.function?.name})`,
              );
            } else if (currentToolCallIndex >= 0) {
              const hasNameFragment =
                typeof chunkToolCall.function?.name === 'string' &&
                chunkToolCall.function.name.length > 0;
              const hasArgumentsFragment =
                typeof chunkToolCall.function?.arguments === 'string' &&
                chunkToolCall.function.arguments.length > 0;
              if (!hasNameFragment && !hasArgumentsFragment) {
                throw new Error(
                  `[EXECUTION] Tool call fragment missing name/arguments for ${toolCalls[currentToolCallIndex].id}`,
                );
              }
              if (hasNameFragment) {
                toolCalls[currentToolCallIndex].function.name += chunkToolCall.function!.name;
              }
              if (hasArgumentsFragment) {
                toolCalls[currentToolCallIndex].function.arguments +=
                  chunkToolCall.function!.arguments;
              }
              const fragmentPreview = hasArgumentsFragment
                ? chunkToolCall.function!.arguments
                : chunkToolCall.function!.name;
              logger.debug(
                `[TOOL-STREAM] Adding fragment to tool ${toolCalls[currentToolCallIndex].id}: "${fragmentPreview}"`,
              );
            }
          }
        }
      }
    }

    logger.debug('[EXECUTION-SERVICE-STREAM] Stream completed, toolCalls detected:', {
      count: toolCalls.length,
    });

    if (typeof fullResponse !== 'string') {
      throw new Error('[EXECUTION] Streaming response content is required');
    }
    conversationSession.addAssistantMessage(fullResponse, toolCalls, {
      executionId,
    });

    if (toolCalls.length > 0) {
      yield* executeStreamToolCalls(
        toolCalls,
        conversationSession,
        streamingConversationId,
        executionId,
        toolExecutionService,
        eventEmitter,
        logger,
      );
    }

    await callPluginHook(
      plugins,
      'afterRun',
      {
        input,
        response: fullResponse,
        ...(context?.metadata ? { metadata: context.metadata as TMetadata } : {}),
      },
      logger,
    );

    yield { chunk: '', isComplete: true };
  } catch (error) {
    logger.error('ExecutionService streaming execution failed', {
      error: error instanceof Error ? error.message : String(error),
      executionTime: Date.now() - startTime,
    });

    await callPluginHook(
      plugins,
      'onError',
      {
        input,
        error: error instanceof Error ? error : new Error(String(error)),
        ...(context?.metadata ? { metadata: context.metadata as TMetadata } : {}),
      },
      logger,
    );

    throw error;
  } finally {
    eventEmitter.resetOwnerPathBases();
  }
}

/**
 * Execute tool calls detected during streaming and yield result chunks
 */
async function* executeStreamToolCalls(
  toolCalls: IToolCall[],
  conversationSession: {
    addToolMessageWithId: (
      content: string,
      toolCallId: string,
      toolName: string,
      metadata?: Record<string, string | number | boolean>,
    ) => void;
  },
  streamingConversationId: string,
  executionId: string,
  toolExecutionService: ToolExecutionService,
  eventEmitter: ExecutionEventEmitter,
  logger: ILogger,
): AsyncGenerator<IStreamChunk> {
  logger.debug('[EXECUTION-SERVICE-STREAM] Executing tools:', {
    tools: toolCalls.map((tc) => tc.function.name),
  });

  const streamingRootId = streamingConversationId;
  const streamingThinkingNodeId = `thinking_${streamingRootId}_${Date.now()}_${executionId}`;
  const streamingOwnerPathBase = [
    ...eventEmitter.buildExecutionOwnerContext(streamingRootId, executionId).ownerPath,
    { type: 'thinking', id: streamingThinkingNodeId },
  ];
  const toolRequests = toolExecutionService.createExecutionRequestsWithContext(toolCalls, {
    ownerPathBase: streamingOwnerPathBase,
  });
  const toolContext: IToolExecutionBatchContext = {
    requests: toolRequests,
    mode: 'parallel',
    maxConcurrency: 5,
    continueOnError: true,
  };

  const toolSummary = await toolExecutionService.executeTools(toolContext);

  for (const toolCall of toolCalls) {
    if (!toolCall.id) {
      throw new Error('[EXECUTION] Tool call missing id in streaming mode');
    }
    if (!toolCall.function?.name || toolCall.function.name.length === 0) {
      throw new Error(
        `[EXECUTION] Tool call "${toolCall.id}" missing function name in streaming mode`,
      );
    }

    const result = toolSummary.results.find((r) => r.executionId === toolCall.id);
    const error = toolSummary.errors.find(
      (e) => isExecutionError(e) && e.executionId === toolCall.id,
    );

    let content: string;
    let metadata: Record<string, string | number | boolean> = {
      executionId,
    };

    if (result && result.success) {
      if (typeof result.result === 'undefined') {
        throw new Error('[EXECUTION] Tool result missing result payload in streaming mode');
      }
      content = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
      metadata['success'] = true;
      if (result.toolName) {
        metadata['toolName'] = result.toolName;
      }

      yield {
        chunk: `\n[Tool: ${toolCall.function.name} executed successfully]`,
        isComplete: false,
      };
    } else if (error) {
      const execError = error as IExecutionError;
      const execMessage = (() => {
        if (execError.error?.message) return execError.error.message;
        if (execError.message) return execError.message;
        return '';
      })();
      if (!execMessage || execMessage.length === 0) {
        throw new Error('[EXECUTION] Tool execution error missing message in streaming mode');
      }
      content = `Error: ${execMessage}`;
      metadata['success'] = false;
      metadata['error'] = execMessage;
      if (execError.toolName) {
        metadata['toolName'] = execError.toolName;
      }

      yield {
        chunk: `\n[Tool: ${toolCall.function.name} failed: ${execMessage}]`,
        isComplete: false,
      };
    } else {
      throw new Error(
        `[EXECUTION] Missing tool result for tool call "${toolCall.id}" in streaming mode`,
      );
    }

    conversationSession.addToolMessageWithId(
      content,
      toolCall.id,
      toolCall.function.name,
      metadata,
    );
  }

  const streamingToolCallIds = toolCalls.map((toolCall) => {
    if (!toolCall.id || toolCall.id.length === 0) {
      throw new Error('[EXECUTION] Tool call missing id for streaming tool results ready payload');
    }
    return toolCall.id;
  });
  if (streamingToolCallIds.length === 0) {
    throw new Error('[EXECUTION] Tool results ready requires toolCallIds in streaming mode');
  }
  eventEmitter.emitExecution(
    EXECUTION_EVENTS.TOOL_RESULTS_READY,
    {
      parameters: {
        toolCallIds: streamingToolCallIds,
        round: 1,
      },
      metadata: {
        toolsExecuted: toolSummary.results.map((r) => {
          if (!r.toolName || r.toolName.length === 0) {
            throw new Error('[EXECUTION] Tool result missing toolName');
          }
          return r.toolName;
        }),
        round: 1,
      },
    },
    streamingConversationId,
    executionId,
  );
}
