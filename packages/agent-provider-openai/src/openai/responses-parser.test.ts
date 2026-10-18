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

describe('OpenAI Responses reasoning summary stream', () => {
  const completed: TOpenAIResponsesStreamEvent = {
    type: 'response.completed',
    response: { id: 'resp-1', output_text: 'The answer.', output: [], status: 'completed' },
  };

  it('hands reasoning summary text to onThinkingDelta, in order, and keeps it out of the reply', async () => {
    const thoughts: string[] = [];
    const replyDeltas: string[] = [];

    const message = await assembleOpenAIResponsesStream({
      stream: eventsFrom([
        { type: 'response.reasoning_summary_text.delta', delta: 'Weighing ' },
        { type: 'response.reasoning_summary_text.delta', delta: 'the options.' },
        { type: 'response.output_text.delta', delta: 'The answer.' },
        completed,
      ]),
      onTextDelta: (delta) => replyDeltas.push(delta),
      onThinkingDelta: (delta) => thoughts.push(delta),
    });

    expect(thoughts).toEqual(['Weighing ', 'the options.']);
    expect(replyDeltas).toEqual(['The answer.']);
    expect(message.content).toBe('The answer.');
  });

  it('does not treat reply text as reasoning', async () => {
    const thoughts: string[] = [];

    await assembleOpenAIResponsesStream({
      stream: eventsFrom([{ type: 'response.output_text.delta', delta: 'The answer.' }, completed]),
      onTextDelta: () => {},
      onThinkingDelta: (delta) => thoughts.push(delta),
    });

    expect(thoughts).toEqual([]);
  });

  it('assembles a reply whose caller registered no reasoning callback', async () => {
    const message = await assembleOpenAIResponsesStream({
      stream: eventsFrom([
        { type: 'response.reasoning_summary_text.delta', delta: 'thinking' },
        { type: 'response.output_text.delta', delta: 'The answer.' },
        completed,
      ]),
    });

    expect(message.content).toBe('The answer.');
  });
});
