import type { TToolChoice } from '@robota-sdk/agent-core';
import type OpenAI from 'openai';

/**
 * Map the provider-agnostic tool-invocation directive onto the OpenAI-compatible
 * `tool_choice` wire parameter (CORE-017). Callers pass it only when tools are present;
 * `undefined` (directive unset) keeps the wire default of `'auto'` explicit so existing
 * request payloads stay byte-identical.
 */
export function toOpenAICompatibleToolChoice(
  toolChoice: TToolChoice | undefined,
): OpenAI.Chat.ChatCompletionCreateParams['tool_choice'] {
  if (toolChoice === undefined || toolChoice === 'auto') {
    return 'auto';
  }
  if (toolChoice === 'none' || toolChoice === 'required') {
    return toolChoice;
  }
  return { type: 'function', function: { name: toolChoice.tool } };
}

/**
 * Map the provider-agnostic tool-invocation directive onto the OpenAI Responses API
 * `tool_choice` parameter (CORE-017). The Responses surface names a forced function with a
 * flat `{ type: 'function', name }` shape instead of Chat Completions' nested form.
 */
export function toOpenAIResponsesToolChoice(
  toolChoice: TToolChoice | undefined,
): 'auto' | 'none' | 'required' | { type: 'function'; name: string } {
  if (toolChoice === undefined || toolChoice === 'auto') {
    return 'auto';
  }
  if (toolChoice === 'none' || toolChoice === 'required') {
    return toolChoice;
  }
  return { type: 'function', name: toolChoice.tool };
}
