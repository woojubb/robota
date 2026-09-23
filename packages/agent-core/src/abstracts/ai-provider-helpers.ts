/**
 * Helper functions for AbstractAIProvider.
 *
 * Extracted from abstracts/abstract-ai-provider.ts to keep that file under 300 lines.
 * Contains message/tool validation and executor delegation utilities.
 */
import type { IExecutor, IExecutorChatResult, TExecutorStreamEvent } from '../interfaces/executor';
import type { TUniversalMessage } from '../interfaces/messages';
import type { IToolSchema, IChatOptions } from '../interfaces/provider';

/**
 * Validate that messages is a non-empty array of messages with valid roles.
 * Throws if validation fails.
 */
export function validateProviderMessages(messages: TUniversalMessage[]): void {
  if (!Array.isArray(messages)) {
    throw new Error('Messages must be an array');
  }
  if (messages.length === 0) {
    throw new Error('Messages array cannot be empty');
  }
  for (const message of messages) {
    if (!message.role || !['user', 'assistant', 'system', 'tool'].includes(message.role)) {
      throw new Error(`Invalid message role: ${message.role}`);
    }
  }
}

/**
 * Validate that tools is an array of tool schemas with name, description, and parameters.
 * No-ops if tools is undefined.
 */
export function validateProviderTools(tools?: IToolSchema[]): void {
  if (!tools) return;
  if (!Array.isArray(tools)) {
    throw new Error('Tools must be an array');
  }
  for (const tool of tools) {
    if (!tool.name || typeof tool.name !== 'string') {
      throw new Error('Tool must have a valid name');
    }
    if (!tool.description || typeof tool.description !== 'string') {
      throw new Error('Tool must have a valid description');
    }
    if (
      !tool.parameters ||
      typeof tool.parameters !== 'object' ||
      tool.parameters === null ||
      Array.isArray(tool.parameters)
    ) {
      throw new Error('Tool must have valid parameters');
    }
  }
}

/**
 * Execute a chat request via an injected executor (non-streaming).
 * Throws if executor or model is missing.
 */
export async function executeChatViaExecutor(
  executor: IExecutor | undefined,
  providerName: string,
  messages: TUniversalMessage[],
  options?: IChatOptions,
): Promise<IExecutorChatResult> {
  if (!executor) {
    throw new Error(
      `Executor is required for ${providerName} provider. Configure an executor or use direct execution path.`,
    );
  }
  if (!options?.model) {
    throw new Error(`Model is required for executor execution in ${providerName} provider.`);
  }
  const result = await executor.executeChat({
    messages,
    options,
    provider: providerName,
    model: options.model,
    ...(options.tools && { tools: options.tools }),
  });
  return result;
}

/**
 * Execute a streaming chat request via an injected executor.
 * Throws if executor or model is missing.
 */
export async function* executeChatStreamViaExecutor(
  executor: IExecutor | undefined,
  providerName: string,
  messages: TUniversalMessage[],
  options?: IChatOptions,
): AsyncIterable<TExecutorStreamEvent> {
  if (!executor || !executor.executeChatStream) {
    throw new Error(`Streaming executor is required for ${providerName} provider.`);
  }
  if (!options?.model) {
    throw new Error(`Model is required for executor streaming in ${providerName} provider.`);
  }
  const stream = executor.executeChatStream({
    messages,
    options,
    provider: providerName,
    model: options.model,
    stream: true,
    ...(options.tools && { tools: options.tools }),
  });
  let terminalSeen = false;
  for await (const event of stream) {
    if (event.kind === 'terminal') {
      if (terminalSeen) {
        throw new Error(`Executor "${providerName}" emitted more than one stream terminal result.`);
      }
      terminalSeen = true;
    }
    yield event;
  }
  if (!terminalSeen) {
    throw new Error(`Executor "${providerName}" ended a stream without a terminal result.`);
  }
}
