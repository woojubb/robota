import type OpenAI from 'openai';
import type { IToolSchema, TUniversalMessage } from '@robota-sdk/agent-core';
import {
  convertToOpenAICompatibleMessages,
  convertToOpenAICompatibleTools,
} from '@robota-sdk/agent-provider-openai-compatible';

/**
 * Convert TUniversalMessage array to OpenAI chat completion message format.
 */
export function convertToOpenAIMessages(
  messages: TUniversalMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return convertToOpenAICompatibleMessages(messages);
}

/**
 * Convert tool schemas to OpenAI function tool format.
 */
export function convertToOpenAITools(tools: IToolSchema[]): OpenAI.Chat.ChatCompletionTool[] {
  return convertToOpenAICompatibleTools(tools);
}
