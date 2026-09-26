import { describe, expect, it } from 'vitest';

import { assembleOpenAIResponsesStream, parseOpenAIResponsesResponse } from './responses-parser';

import type {
  IOpenAIResponsesResponse,
  IOpenAIResponsesUsage,
  TOpenAIResponsesStreamEvent,
} from './responses-types';

function responseWithUsage(usage: IOpenAIResponsesUsage): IOpenAIResponsesResponse {
  return {
    id: 'resp-cached',
    model: 'gpt-4o',
    output_text: 'ok',
    output: [],
    status: 'completed',
    usage,
  };
}

function usageOf(message: unknown): Record<string, number> | undefined {
  return (message as { usage?: Record<string, number> }).usage;
}

async function* eventsFrom(
  events: TOpenAIResponsesStreamEvent[],
): AsyncIterable<TOpenAIResponsesStreamEvent> {
  for (const event of events) yield event;
}

describe('OpenAI Responses usage', () => {
  it('surfaces input_tokens_details.cached_tokens as cacheReadTokens on the message usage', () => {
    const message = parseOpenAIResponsesResponse(
      responseWithUsage({
        input_tokens: 1000,
        output_tokens: 20,
        total_tokens: 1020,
        input_tokens_details: { cached_tokens: 800 },
      }),
    );

    expect(usageOf(message)).toEqual({
      promptTokens: 1000,
      completionTokens: 20,
      totalTokens: 1020,
      cacheReadTokens: 800,
    });
  });

  it('adds no cacheReadTokens when the usage carries no cached-token details', () => {
    const message = parseOpenAIResponsesResponse(
      responseWithUsage({ input_tokens: 1000, output_tokens: 20, total_tokens: 1020 }),
    );

    expect(usageOf(message)).toBeDefined();
    expect(usageOf(message)).not.toHaveProperty('cacheReadTokens');
  });

  it('leaves totalTokens absent when the response omits total_tokens', () => {
    const message = parseOpenAIResponsesResponse(
      responseWithUsage({ input_tokens: 5000, output_tokens: 100 }),
    );

    expect(usageOf(message)).toEqual({ promptTokens: 5000, completionTokens: 100 });
    expect(message.metadata?.['usageProvenance']).toBe('partial');
  });

  it('carries the cached tokens of a streamed response.completed usage', async () => {
    const message = await assembleOpenAIResponsesStream({
      stream: eventsFrom([
        { type: 'response.output_text.delta', delta: 'ok' },
        {
          type: 'response.completed',
          response: responseWithUsage({
            input_tokens: 1000,
            output_tokens: 20,
            total_tokens: 1020,
            input_tokens_details: { cached_tokens: 800 },
          }),
        },
      ]),
    });

    expect(usageOf(message)).toMatchObject({ promptTokens: 1000, cacheReadTokens: 800 });
  });
});
