import type { IAgentConfig, IAssistantMessage, IToolMessage } from '../interfaces/agent';
import type { IAIProviderManager } from '../interfaces/manager';
import type { IToolManager } from '../interfaces/manager';
import { type ConversationStore } from '../managers/conversation-history-manager';
import type { TUniversalMessage } from '../interfaces/messages';
import type { TPluginWithHooks } from './plugin-hook-dispatcher';
import { callPluginHook } from './plugin-hook-dispatcher';
import type { ILogger } from '../utils/logger';
import type { ExecutionEventEmitter } from './execution-event-emitter';
import { EXECUTION_EVENTS } from './execution-constants';
import {
  type IResolvedProviderInfo,
  type IExecutionContext,
  type IExecutionResult,
  ID_RADIX,
  ID_RANDOM_LENGTH,
} from './execution-types';

/**
 * Resolve the current AI provider and available tools from managers.
 * Pure function — no class instance needed.
 */
export function resolveProviderAndTools(
  aiProviders: IAIProviderManager,
  tools: IToolManager,
  config: IAgentConfig,
): IResolvedProviderInfo {
  const currentInfo = aiProviders.getCurrentProvider();
  const provider = currentInfo ? aiProviders.getProvider(currentInfo.provider) : null;
  if (!currentInfo || !currentInfo.provider || !provider) {
    throw new Error('[EXECUTION] Provider is required');
  }
  const availableTools = tools.getTools();
  const aiProviderInfo = {
    providerName: currentInfo.provider,
    model: config.defaultModel.model,
    temperature: config.defaultModel.temperature,
    maxTokens: config.defaultModel.maxTokens,
  };
  const toolsInfo = availableTools.map((tool) => {
    const paramSchema = tool.parameters as { properties?: Record<string, object> } | undefined;
    const props = paramSchema?.properties;
    if (!tool.description || tool.description.length === 0) {
      throw new Error(`[EXECUTION] Tool "${tool.name}" is missing description`);
    }
    return {
      name: tool.name,
      description: tool.description,
      parameters: props && typeof props === 'object' ? Object.keys(props) : [],
    };
  });
  return { provider, currentInfo, aiProviderInfo, toolsInfo, availableTools };
}

/**
 * Validate that the resolved provider is usable.
 */
export function validateProvider(resolved: IResolvedProviderInfo): void {
  if (!resolved.currentInfo) throw new Error('No AI provider configured');
  if (!resolved.provider)
    throw new Error(`AI provider '${resolved.currentInfo.provider}' not found`);
  if (typeof resolved.provider.chat !== 'function') {
    throw new Error('Provider must have chat method to support execution');
  }
}

/**
 * Initialize or restore a conversation store for the given conversation.
 */
export function initializeConversationStore(
  conversationHistory: { getConversationStore: (id: string) => ConversationStore },
  conversationId: string,
  messages: TUniversalMessage[],
  config: IAgentConfig,
  executionId: string,
): ConversationStore {
  const session = conversationHistory.getConversationStore(conversationId);
  if (session.getMessageCount() === 0 && messages.length > 0) {
    for (const msg of messages) {
      if (msg.role === 'user') {
        session.addUserMessage(msg.content, msg.metadata, msg.parts);
      } else if (msg.role === 'assistant') {
        session.addAssistantMessage(
          msg.content,
          (msg as IAssistantMessage).toolCalls,
          msg.metadata,
          msg.parts,
        );
      } else if (msg.role === 'system') {
        session.addSystemMessage(msg.content, msg.metadata, msg.parts);
      } else if (msg.role === 'tool') {
        const toolName = msg.metadata?.['toolName'];
        if (typeof toolName !== 'string' || toolName.length === 0) {
          throw new Error('[EXECUTION] Tool message missing toolName metadata');
        }
        session.addToolMessageWithId(
          msg.content,
          (msg as IToolMessage).toolCallId,
          toolName,
          msg.metadata,
          msg.parts,
        );
      }
    }
  }
  if (config.systemMessage) {
    session.addSystemMessage(config.systemMessage, { executionId });
  }
  return session;
}

/**
 * Build the final IExecutionResult from the completed conversation store.
 */
export function buildFinalResult(
  conversationStore: ConversationStore,
  executionId: string,
  startTime: Date,
  toolsExecuted: string[],
): IExecutionResult {
  const finalMessages = conversationStore.getMessages();
  // Find last assistant message with actual content (skip stripped tool-round messages)
  const lastAssistantMessage = finalMessages
    .filter(
      (msg) =>
        msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.length > 0,
    )
    .pop();
  const response: string = lastAssistantMessage
    ? (lastAssistantMessage.content as string)
    : 'No response received. The context window may be full.';
  const duration = Date.now() - startTime.getTime();
  return {
    response,
    messages: finalMessages.map((msg) => {
      if (typeof msg.content !== 'string')
        throw new Error('[EXECUTION] Message content is required');
      return {
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        metadata: msg.metadata,
        ...(msg.role === 'assistant' && 'toolCalls' in msg ? { toolCalls: msg.toolCalls } : {}),
        ...(msg.role === 'tool' && 'toolCallId' in msg ? { toolCallId: msg.toolCallId } : {}),
      };
    }) as TUniversalMessage[],
    executionId,
    duration,
    tokensUsed: finalMessages
      .filter((msg) => msg.metadata?.['usage'])
      .reduce((sum, msg) => {
        const usage = msg.metadata?.['usage'];
        if (usage && typeof usage === 'object' && 'totalTokens' in usage) {
          const totalTokens = Number(usage.totalTokens);
          if (Number.isNaN(totalTokens))
            throw new Error('[EXECUTION] totalTokens must be a number');
          return sum + totalTokens;
        }
        return sum;
      }, 0),
    toolsExecuted,
    success: !!lastAssistantMessage,
  };
}

/**
 * Handle a non-abort error from the execution pipeline:
 * fires onError plugin hook and emits the error event.
 */
export async function handleExecutionError(
  error: unknown,
  fullContext: IExecutionContext,
  startTime: Date,
  conversationId: string,
  executionId: string,
  plugins: TPluginWithHooks[],
  logger: ILogger,
  eventEmitter: ExecutionEventEmitter,
): Promise<void> {
  const duration = Date.now() - startTime.getTime();
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  await callPluginHook(
    plugins,
    'onError',
    {
      error: normalizedError,
      executionContext: convertExecutionContextToPluginFormat(fullContext),
    },
    logger,
  );
  logger.error('Execution pipeline failed', {
    executionId,
    conversationId,
    duration,
    error: error instanceof Error ? error.message : String(error),
  });
  eventEmitter.emitExecution(
    EXECUTION_EVENTS.ERROR,
    {
      error: error instanceof Error ? error.message : String(error),
      metadata: { method: 'execute', success: false, duration },
    },
    conversationId,
    executionId,
  );
}

/**
 * Generate a unique execution ID.
 */
export function generateExecutionId(): string {
  return `exec_${Date.now()}_${Math.random().toString(ID_RADIX).substr(2, ID_RANDOM_LENGTH)}`;
}

/**
 * Assert that a conversationId is present and non-empty, throwing with context label.
 */
export function requireConversationId(
  context: { conversationId?: string } | undefined,
  label: string,
): string {
  if (!context?.conversationId || context.conversationId.length === 0) {
    throw new Error(`[EXECUTION] conversationId is required for ${label}`);
  }
  return context.conversationId;
}

/**
 * Convert an IExecutionContext to the flat record format expected by plugin hooks.
 */
export function convertExecutionContextToPluginFormat(
  context: IExecutionContext,
): Record<string, string | number | boolean> {
  const conversationId = requireConversationId(context, 'plugin-context');
  const payload: Record<string, string | number | boolean> = {
    conversationId,
    executionId: context.executionId,
    startTime: context.startTime.toISOString(),
    messageCount: context.messages.length,
  };
  if (context.sessionId) payload.sessionId = context.sessionId;
  if (context.userId) payload.userId = context.userId;
  return payload;
}
