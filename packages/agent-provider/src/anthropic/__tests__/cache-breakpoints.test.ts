/**
 * Prompt-cache breakpoints: the API caches the prompt up to a marked block in the order tools,
 * system, messages. The request marks the end of the system prompt and the end of the history, only
 * on the vendor endpoint, and never changes what the model is shown.
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
import { cachedSystem, withTailBreakpoint } from '../cache-breakpoints';
import { AnthropicProvider } from '../provider';

const MARK = { type: 'ephemeral' };

describe('cachedSystem', () => {
  it('is one text block that ends a cached prefix', () => {
    expect(cachedSystem('be brief')).toEqual([
      { type: 'text', text: 'be brief', cache_control: MARK },
    ]);
  });
});

describe('withTailBreakpoint', () => {
  it('turns a string tail into a marked text block', () => {
    expect(withTailBreakpoint([{ role: 'user', content: 'hello' }])).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello', cache_control: MARK }] },
    ]);
  });

  it('marks only the last block of the last message', () => {
    const marked = withTailBreakpoint([
      { role: 'user', content: 'first' },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'a', content: 'one' },
          { type: 'tool_result', tool_use_id: 'b', content: 'two' },
        ],
      },
    ]);
    expect(marked[0]).toEqual({ role: 'user', content: 'first' });
    expect(marked[1]?.content).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: 'one' },
      { type: 'tool_result', tool_use_id: 'b', content: 'two', cache_control: MARK },
    ]);
  });

  it('marks a tool call that ends an assistant message', () => {
    const marked = withTailBreakpoint([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'looking' },
          { type: 'tool_use', id: 'x', name: 'Read', input: {} },
        ],
      },
    ]);
    expect(marked[0]?.content).toEqual([
      { type: 'text', text: 'looking' },
      { type: 'tool_use', id: 'x', name: 'Read', input: {}, cache_control: MARK },
    ]);
  });

  it('walks back past a block a marker cannot sit on', () => {
    const marked = withTailBreakpoint([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'answer' },
          { type: 'thinking', thinking: 'hm', signature: 'sig' },
        ],
      },
    ]);
    expect(marked[0]?.content).toEqual([
      { type: 'text', text: 'answer', cache_control: MARK },
      { type: 'thinking', thinking: 'hm', signature: 'sig' },
    ]);
  });

  it('leaves a history with nothing to mark as it is', () => {
    const empty: Anthropic.MessageParam[] = [];
    const blank: Anthropic.MessageParam[] = [{ role: 'user', content: '' }];
    expect(withTailBreakpoint(empty)).toBe(empty);
    expect(withTailBreakpoint(blank)).toBe(blank);
  });

  it('does not modify its input', () => {
    const original: Anthropic.MessageParam[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ];
    const snapshot = JSON.stringify(original);
    withTailBreakpoint(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe('Anthropic request breakpoints', () => {
  let mockClient: { messages: { create: ReturnType<typeof vi.fn> } };

  const conversation: TUniversalMessage[] = [
    {
      id: '1',
      role: 'system',
      content: 'You are helpful',
      state: 'complete',
      timestamp: new Date(),
    },
    { id: '2', role: 'user', content: 'first question', state: 'complete', timestamp: new Date() },
    {
      id: '3',
      role: 'assistant',
      content: 'first answer',
      state: 'complete',
      timestamp: new Date(),
    },
    { id: '4', role: 'user', content: 'second question', state: 'complete', timestamp: new Date() },
  ];

  function endedStream(): AsyncIterable<Record<string, unknown>> {
    const events = [
      {
        type: 'message_start',
        message: { usage: { input_tokens: 1, output_tokens: 0 }, model: 'm' },
      },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    ];
    return {
      async *[Symbol.asyncIterator]() {
        for (const event of events) yield event;
      },
    } as AsyncIterable<Record<string, unknown>>;
  }

  /** Every cache marker in a request body, wherever it sits. */
  function markerCount(params: unknown): number {
    return (JSON.stringify(params).match(/"cache_control"/g) ?? []).length;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = { messages: { create: vi.fn().mockImplementation(async () => endedStream()) } };
  });

  it('marks the end of the system prompt and the end of the history, and nothing else', async () => {
    const provider = new AnthropicProvider({ client: mockClient as unknown as Anthropic });
    await provider.chat(conversation, { model: 'claude-test' });

    const params = mockClient.messages.create.mock.calls[0]?.[0];
    expect(params.system).toEqual([{ type: 'text', text: 'You are helpful', cache_control: MARK }]);
    expect(params.messages.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'second question', cache_control: MARK }],
    });
    expect(markerCount(params)).toBe(2);
  });

  it('shows the model the same text with and without the markers', async () => {
    const vendor = new AnthropicProvider({ client: mockClient as unknown as Anthropic });
    const gateway = new AnthropicProvider({
      client: mockClient as unknown as Anthropic,
      baseURL: 'https://gateway.example.test',
    });
    await vendor.chat(conversation, { model: 'claude-test' });
    await gateway.chat(conversation, { model: 'claude-test' });

    const strip = (params: unknown): unknown =>
      JSON.parse(JSON.stringify(params).replace(/,"cache_control":\{"type":"ephemeral"\}/g, ''));
    const [vendorParams, gatewayParams] = mockClient.messages.create.mock.calls.map(
      (call) => call[0],
    );
    const text = (params: { system: unknown; messages: unknown[] }): string =>
      JSON.stringify({
        system:
          typeof params.system === 'string'
            ? params.system
            : (params.system as Array<{ text: string }>)[0]?.text,
        messages: params.messages.map((message) => {
          const entry = message as { role: string; content: string | Array<{ text: string }> };
          return {
            role: entry.role,
            text:
              typeof entry.content === 'string'
                ? entry.content
                : entry.content.map((block) => block.text).join(''),
          };
        }),
      });
    expect(text(strip(vendorParams) as never)).toBe(text(gatewayParams));
  });

  it('sends no marker to a configured gateway', async () => {
    const provider = new AnthropicProvider({
      client: mockClient as unknown as Anthropic,
      baseURL: 'https://gateway.example.test',
    });
    await provider.chat(conversation, { model: 'claude-test' });

    const params = mockClient.messages.create.mock.calls[0]?.[0];
    expect(params.system).toBe('You are helpful');
    expect(markerCount(params)).toBe(0);
  });

  it('marks the tail of each call, so a later call reads what the earlier one wrote', async () => {
    const provider = new AnthropicProvider({ client: mockClient as unknown as Anthropic });
    await provider.chat(
      conversation.slice(0, 3).concat({ ...conversation[1]!, id: '5', content: 'next' }),
      {
        model: 'claude-test',
      },
    );
    await provider.chat(conversation, { model: 'claude-test' });

    const [first, second] = mockClient.messages.create.mock.calls.map((call) => call[0]);
    expect(first.system).toEqual(second.system);
    expect(markerCount(first)).toBe(2);
    expect(markerCount(second)).toBe(2);
  });
});
