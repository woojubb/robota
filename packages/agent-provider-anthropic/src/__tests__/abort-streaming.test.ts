/**
 * Tests for abort signal behavior during streaming.
 * Verifies that ESC (AbortSignal) stops event processing promptly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TUniversalMessage } from '@robota-sdk/agent-core';

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn() },
  }));
  return { default: MockAnthropic };
});

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from '../provider';

/**
 * Create a stream with N text_delta events.
 * onEventYielded fires after each event is consumed by the iterator.
 */
function makeDeltaStream(
  chunks: string[],
  onEventYielded?: (index: number) => void,
): AsyncIterable<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [
    {
      type: 'message_start',
      message: {
        usage: { input_tokens: 100, output_tokens: 0 },
        model: 'claude-3-opus-20240229',
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
  ];
  for (const chunk of chunks) {
    events.push({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: chunk },
    });
  }
  events.push({ type: 'content_block_stop', index: 0 });
  events.push({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 50 },
  });

  let idx = 0;
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (idx < events.length) {
            const event = events[idx];
            onEventYielded?.(idx);
            idx++;
            return Promise.resolve({ value: event, done: false });
          }
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  } as AsyncIterable<Record<string, unknown>>;
}

describe('AnthropicProvider abort streaming', () => {
  let provider: AnthropicProvider;
  let mockClient: { messages: { create: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = { messages: { create: vi.fn() } };
    provider = new AnthropicProvider({
      client: mockClient as unknown as Anthropic,
    });
  });

  const userMsg: TUniversalMessage[] = [
    { id: '1', role: 'user', content: 'test', state: 'complete', timestamp: new Date() },
  ];

  it('stops processing after signal.aborted and returns partial content', async () => {
    const controller = new AbortController();
    const chunks = ['A', 'B', 'C', 'D', 'E'];

    // Event indices: 0=msg_start, 1=block_start, 2=A_delta, 3=B_delta, 4=C_delta, 5=D_delta, 6=E_delta
    const stream = makeDeltaStream(chunks, (idx) => {
      // Abort after processing B (idx 3 = B_delta yielded)
      if (idx === 3) controller.abort();
    });
    mockClient.messages.create.mockResolvedValue(stream);

    const result = await provider.chat(userMsg, {
      signal: controller.signal,
      model: 'claude-3-opus-20240229',
    });

    const content = result.content as string;
    // A was processed before abort. B triggered abort on yield — may or may not be included.
    expect(content).toContain('A');
    // D and E definitely not processed (after abort)
    expect(content).not.toContain('D');
    expect(content).not.toContain('E');
    // Partial result returned
    expect(result.metadata?.stopReason).toBe('aborted');
  });

  it('returns metadata with stopReason aborted', async () => {
    const controller = new AbortController();
    // idx: 0=msg_start, 1=block_start, 2=Hello_delta, 3=World_delta
    const stream = makeDeltaStream(['Hello', ' World'], (idx) => {
      if (idx === 2) controller.abort(); // abort when Hello is yielded
    });
    mockClient.messages.create.mockResolvedValue(stream);

    const result = await provider.chat(userMsg, {
      signal: controller.signal,
      model: 'claude-3-opus-20240229',
    });
    expect(result.metadata?.stopReason).toBe('aborted');
  });

  it('delivers onTextDelta only for chunks before abort', async () => {
    const controller = new AbortController();
    const chunks = ['X', 'Y', 'Z'];
    const deltas: string[] = [];

    // idx: 0=msg_start, 1=block_start, 2=X_delta, 3=Y_delta, 4=Z_delta
    const stream = makeDeltaStream(chunks, (idx) => {
      if (idx === 3) controller.abort(); // abort when Y is yielded
    });
    mockClient.messages.create.mockResolvedValue(stream);

    await provider.chat(userMsg, {
      signal: controller.signal,
      onTextDelta: (d: string) => deltas.push(d),
      model: 'claude-3-opus-20240229',
    });

    // X was processed. Y triggered abort — may not have been delivered to onTextDelta.
    expect(deltas).toContain('X');
    // Z definitely not delivered
    expect(deltas).not.toContain('Z');
    // Total deltas should be less than all chunks
    expect(deltas.length).toBeLessThan(chunks.length);
  });

  it('handles already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort(); // Pre-aborted

    const stream = makeDeltaStream(['Should', 'Not', 'Appear']);
    mockClient.messages.create.mockResolvedValue(stream);

    const result = await provider.chat(userMsg, {
      signal: controller.signal,
      model: 'claude-3-opus-20240229',
    });
    const content = result.content as string;
    expect(content).not.toContain('Should');
    expect(content).not.toContain('Appear');
  });

  it('processes all events when no abort signal', async () => {
    const chunks = ['Hello', ' ', 'World'];
    const stream = makeDeltaStream(chunks);
    mockClient.messages.create.mockResolvedValue(stream);

    const result = await provider.chat(userMsg, { model: 'claude-3-opus-20240229' });
    expect(result.content).toBe('Hello World');
  });
});
