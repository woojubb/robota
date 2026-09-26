import {
  convertToOpenAICompatibleMessages,
  convertToOpenAICompatibleTools,
} from '@robota-sdk/agent-provider-openai-compatible/shared';

import type { IToolSchema, TUniversalMessage } from '@robota-sdk/agent-core';
import type OpenAI from 'openai';

/**
 * Convert TUniversalMessage array to OpenAI chat completion message format.
 */
export function convertToOpenAIMessages(
  messages: TUniversalMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return convertToOpenAICompatibleMessages(messages);
}

/**
 * Convert tool schemas to OpenAI function tool format. With `strictTools` each function is declared
 * `strict: true`, as the Responses surface does, so strict mode is requested on both surfaces.
 */
export function convertToOpenAITools(
  tools: IToolSchema[],
  strictTools?: boolean,
): OpenAI.Chat.ChatCompletionTool[] {
  return convertToOpenAICompatibleTools(tools, { strict: strictTools === true });
}
