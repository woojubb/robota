/**
 * The API reports `input_tokens` as the uncached remainder of the prompt and the cache read and
 * cache write beside it. The recorded input is the whole prompt with the cache read a subset of it,
 * so these tests pin the sum and the subset on every path that records a provider call's usage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sumMessagesUsage } from '@robota-sdk/agent-core';
import type { TUniversalMessage } from '@robota-sdk/agent-core';

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn() },
  }));
  return { default: MockAnthropic };
});

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from '../provider';
import { AnthropicResponseParser } from '../parsers/response-parser';
import { countAnthropicUsage } from '../usage';
import type { IAnthropicMessage, IAnthropicUsage } from '../types/api-types';

function streamOf(
  start: Record<string, unknown>,
  endUsage: Record<string, unknown> = { output_tokens: 50 },
  onYield?: (index: number) => void,
): AsyncIterable<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [
    { type: 'message_start', message: { usage: start, model: 'claude-test' } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: endUsage },
  ];
  return {
    async *[Symbol.asyncIterator]() {
      for (const [index, event] of events.entries()) {
        onYield?.(index);
        yield event;
      }
    },
  } as AsyncIterable<Record<string, unknown>>;
}

describe('countAnthropicUsage', () => {
  it('adds the cache read and write back to the uncached remainder and reports the read', () => {
    const usage: IAnthropicUsage = {
      input_tokens: 40,
      output_tokens: 7,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 60,
    };
    expect(countAnthropicUsage(usage)).toEqual({
      inputTokens: 1000,
      outputTokens: 7,
      cacheReadTokens: 900,
    });
  });

  it('reports a cache read of zero as a read of zero', () => {
    expect(
      countAnthropicUsage({
        input_tokens: 10,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      }),
    ).toEqual({ inputTokens: 10, outputTokens: 1, cacheReadTokens: 0 });
  });

  it('counts a cache write without inventing a cache read', () => {
    const counts = countAnthropicUsage({
      input_tokens: 10,
      output_tokens: 1,
      cache_creation_input_tokens: 500,
    });
    expect(counts).toEqual({ inputTokens: 510, outputTokens: 1 });
    expect(counts).not.toHaveProperty('cacheReadTokens');
  });

  it('treats null and omitted cache fields as not reported', () => {
    const nulls = countAnthropicUsage({
      input_tokens: 10,
      output_tokens: 1,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    });
    const omitted = countAnthropicUsage({ input_tokens: 10, output_tokens: 1 });
    expect(nulls).toEqual({ inputTokens: 10, outputTokens: 1 });
    expect(omitted).toEqual({ inputTokens: 10, outputTokens: 1 });
    expect(nulls).not.toHaveProperty('cacheReadTokens');
  });
});

describe('Anthropic non-streaming response usage', () => {
  const message = (usage: IAnthropicUsage): IAnthropicMessage => ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'hi' }],
    model: 'claude-test',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage,
  });

  it('records the whole prompt and the cache read', () => {
    const parsed = AnthropicResponseParser.parseResponse(
      message({
        input_tokens: 40,
        output_tokens: 10,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 60,
      }),
    );
    expect(sumMessagesUsage([parsed])).toEqual({
      promptTokens: 1000,
      completionTokens: 10,
      totalTokens: 1010,
      cacheReadTokens: 900,
    });
  });

  it('records no cache read when the API reported none', () => {
    const parsed = AnthropicResponseParser.parseResponse(
      message({ input_tokens: 40, output_tokens: 10 }),
    );
    const usage = sumMessagesUsage([parsed]);
    expect(usage).toEqual({ promptTokens: 40, completionTokens: 10, totalTokens: 50 });
    expect(usage).not.toHaveProperty('cacheReadTokens');
  });
});

describe('Anthropic streamed response usage', () => {
  let provider: AnthropicProvider;
  let mockClient: { messages: { create: ReturnType<typeof vi.fn> } };

  const userMessage: TUniversalMessage[] = [
    { id: '1', role: 'user', content: 'test', state: 'complete', timestamp: new Date() },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = { messages: { create: vi.fn() } };
    provider = new AnthropicProvider({ client: mockClient as unknown as Anthropic });
  });

  it('records the whole prompt and the cache read of a completed call', async () => {
    mockClient.messages.create.mockResolvedValue(
      streamOf({
        input_tokens: 40,
        output_tokens: 0,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 60,
      }),
    );
    const result = await provider.chat(userMessage, { model: 'claude-test' });

    expect(result.metadata).toMatchObject({
      inputTokens: 1000,
      outputTokens: 50,
      cacheReadTokens: 900,
      usageProvenance: 'complete',
    });
    expect(sumMessagesUsage([result])).toEqual({
      promptTokens: 1000,
      completionTokens: 50,
      totalTokens: 1050,
      cacheReadTokens: 900,
    });
  });

  it('records no cache read when the stream reported none', async () => {
    mockClient.messages.create.mockResolvedValue(streamOf({ input_tokens: 40, output_tokens: 0 }));
    const result = await provider.chat(userMessage, { model: 'claude-test' });

    expect(result.metadata).toMatchObject({ inputTokens: 40, outputTokens: 50 });
    expect(result.metadata).not.toHaveProperty('cacheReadTokens');
  });

  it('keeps the cache read of a call that was cut short', async () => {
    const controller = new AbortController();
    mockClient.messages.create.mockResolvedValue(
      streamOf(
        {
          input_tokens: 40,
          output_tokens: 0,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 60,
        },
        { output_tokens: 50 },
        // Abort while the text delta is being read: the call started, so its prompt was processed.
        (index) => {
          if (index === 2) controller.abort();
        },
      ),
    );
    const result = await provider.chat(userMessage, {
      model: 'claude-test',
      signal: controller.signal,
    });

    expect(result.metadata).toMatchObject({
      inputTokens: 1000,
      cacheReadTokens: 900,
      usageProvenance: 'partial',
      stopReason: 'aborted',
    });
  });
});
