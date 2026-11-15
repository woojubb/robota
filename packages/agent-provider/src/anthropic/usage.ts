import type { IAnthropicUsage } from './types/api-types';

/** The token counts agent-core records for one provider call. */
export interface IAnthropicUsageCounts {
  /** The whole prompt, including the parts served from and written to the prompt cache. */
  inputTokens: number;
  outputTokens: number;
  /** The part of `inputTokens` served from the prompt cache; present only when the API reported it. */
  cacheReadTokens?: number;
}

/**
 * Count one call's usage the way agent-core records it.
 *
 * The API reports `input_tokens` as the uncached remainder of the prompt and the cache read and
 * cache write beside it, while the recorded input is the whole prompt with the cache read a subset
 * of it. Adding the parts back keeps the recorded prompt size and the cache read consistent, so a
 * prompt that starts hitting the cache does not look as small as its uncached tail.
 */
export function countAnthropicUsage(usage: IAnthropicUsage): IAnthropicUsageCounts {
  const cacheRead = reportedCount(usage.cache_read_input_tokens);
  const cacheWrite = reportedCount(usage.cache_creation_input_tokens);
  return {
    inputTokens: usage.input_tokens + (cacheRead ?? 0) + (cacheWrite ?? 0),
    outputTokens: usage.output_tokens,
    ...(cacheRead !== undefined && { cacheReadTokens: cacheRead }),
  };
}

/** A count the API reported; an omitted or null field is not a zero. */
function reportedCount(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
