import type { ITokenUsageWithCacheRead } from '@robota-sdk/agent-core';
import type OpenAI from 'openai';

/**
 * Map Chat Completions usage (a response's `usage`, or the final streamed usage chunk) onto the
 * message usage agent-core normalizes. `prompt_tokens_details.cached_tokens` is the part of
 * `prompt_tokens` served from the prompt cache; it is carried only when the endpoint reported it.
 */
export function parseChatCompletionUsage(usage: OpenAI.CompletionUsage): ITokenUsageWithCacheRead {
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    ...(typeof cachedTokens === 'number' && { cacheReadTokens: cachedTokens }),
  };
}
