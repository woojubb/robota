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

  describe('separating one thought from the next', () => {
    const part = (itemId: string, summaryIndex: number): TOpenAIResponsesStreamEvent => ({
      type: 'response.reasoning_summary_part.added',
      item_id: itemId,
      summary_index: summaryIndex,
    });
    const delta = (
      itemId: string,
      summaryIndex: number,
      text: string,
    ): TOpenAIResponsesStreamEvent => ({
      type: 'response.reasoning_summary_text.delta',
      item_id: itemId,
      summary_index: summaryIndex,
      delta: text,
    });

    async function thoughtsOf(events: TOpenAIResponsesStreamEvent[]): Promise<string[]> {
      const thoughts: string[] = [];
      await assembleOpenAIResponsesStream({
        stream: eventsFrom([...events, completed]),
        onThinkingDelta: (text) => thoughts.push(text),
      });
      return thoughts;
    }

    it('starts a later summary part of the same reasoning item on a new paragraph', async () => {
      const thoughts = await thoughtsOf([
        part('rs_1', 0),
        delta('rs_1', 0, 'Weighing '),
        delta('rs_1', 0, 'the options.'),
        part('rs_1', 1),
        delta('rs_1', 1, 'Picking one.'),
      ]);

      expect(thoughts.join('')).toBe('Weighing the options.\n\nPicking one.');
      expect(thoughts).toEqual(['Weighing ', 'the options.', '\n\nPicking one.']);
    });

    it('starts the summary of a later reasoning item on a new paragraph', async () => {
      const thoughts = await thoughtsOf([
        part('rs_1', 0),
        delta('rs_1', 0, 'Before the tool.'),
        part('rs_2', 0),
        delta('rs_2', 0, 'After the tool.'),
      ]);

      expect(thoughts.join('')).toBe('Before the tool.\n\nAfter the tool.');
    });

    it('tells parts apart by the index each delta carries when no part event was streamed', async () => {
      const thoughts = await thoughtsOf([
        delta('rs_1', 0, 'One.'),
        delta('rs_1', 0, ' Still one.'),
        delta('rs_1', 1, 'Two.'),
      ]);

      expect(thoughts.join('')).toBe('One. Still one.\n\nTwo.');
    });

    it('does not put a break before the first thought or around a part that carried no text', async () => {
      const thoughts = await thoughtsOf([
        part('rs_1', 0),
        part('rs_1', 1),
        delta('rs_1', 1, 'Only this.'),
        part('rs_1', 2),
      ]);

      expect(thoughts).toEqual(['Only this.']);
    });

    it('does not separate a stream whose deltas name no part', async () => {
      const thoughts = await thoughtsOf([
        { type: 'response.reasoning_summary_text.delta', delta: 'a' },
        { type: 'response.reasoning_summary_text.delta', delta: 'b' },
      ]);

      expect(thoughts).toEqual(['a', 'b']);
    });
  });
});
