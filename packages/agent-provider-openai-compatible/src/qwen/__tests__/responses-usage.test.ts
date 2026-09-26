import { describe, expect, it } from 'vitest';

import { parseQwenResponsesResponse } from '../responses-parser';

import type { IQwenResponsesUsage } from '../types';

function usageOf(usage: IQwenResponsesUsage): Record<string, number> | undefined {
  const message = parseQwenResponsesResponse(
    {
      id: 'resp-cached',
      model: 'qwen-plus',
      output_text: 'ok',
      output: [],
      status: 'completed',
      usage,
    },
    { enabledBuiltInTools: [] },
  );
  return (message as { usage?: Record<string, number> }).usage;
}

describe('Qwen Responses usage', () => {
  it('surfaces input_tokens_details.cached_tokens as cacheReadTokens on the message usage', () => {
    expect(
      usageOf({
        input_tokens: 1000,
        output_tokens: 20,
        total_tokens: 1020,
        input_tokens_details: { cached_tokens: 800 },
      }),
    ).toEqual({
      promptTokens: 1000,
      completionTokens: 20,
      totalTokens: 1020,
      cacheReadTokens: 800,
    });
  });

  it('adds no cacheReadTokens when the usage carries no cached-token details', () => {
    const usage = usageOf({ input_tokens: 1000, output_tokens: 20, total_tokens: 1020 });
    expect(usage).toBeDefined();
    expect(usage).not.toHaveProperty('cacheReadTokens');
  });
});
