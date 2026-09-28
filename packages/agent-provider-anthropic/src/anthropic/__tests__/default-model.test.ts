import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

const sdk = vi.hoisted(() => ({ create: vi.fn() }));

// The provider builds its SDK client from the API key; every client it builds shares one spy.
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({ messages: { create: sdk.create } })),
}));

const { AnthropicProvider } = await import('../provider');
const { createAnthropicProviderDefinition } = await import('../provider-definition');

const MESSAGES: TUniversalMessage[] = [
  { id: 'u1', role: 'user', content: 'hello', state: 'complete', timestamp: new Date() },
];

function streamOf(text: string): AsyncIterable<Record<string, unknown>> {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
  };
}

function requestedModels(): unknown[] {
  return sdk.create.mock.calls.map((call) => (call[0] as { model?: unknown }).model);
}

describe('AnthropicProvider defaultModel', () => {
  beforeEach(() => {
    sdk.create.mockReset();
    sdk.create.mockImplementation(async () => streamOf('ok'));
  });

  it('requests the default model when a chat call names none', async () => {
    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-test',
      defaultModel: 'claude-sonnet-4-5',
    });

    await provider.chat(MESSAGES);
    for await (const _chunk of provider.chatStream(MESSAGES)) {
      /* consume */
    }

    expect(requestedModels()).toEqual(['claude-sonnet-4-5', 'claude-sonnet-4-5']);
  });

  it('lets the model a chat call names win over the default', async () => {
    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-test',
      defaultModel: 'claude-sonnet-4-5',
    });

    await provider.chat(MESSAGES, { model: 'claude-opus-4-5' });

    expect(requestedModels()).toEqual(['claude-opus-4-5']);
  });

  it('resolves a requested effort for the default model', async () => {
    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-test',
      defaultModel: 'claude-sonnet-4-6',
    });

    await provider.chat(MESSAGES, { effort: 'low' });

    expect(sdk.create.mock.calls[0]?.[0]).toMatchObject({
      model: 'claude-sonnet-4-6',
      output_config: { effort: 'low' },
    });
  });

  it('uses the model a provider definition configures', async () => {
    const definition = createAnthropicProviderDefinition();
    const provider = definition.createProvider({
      name: 'anthropic',
      apiKey: 'sk-ant-test',
      model: 'claude-haiku-4-5',
    });

    await provider.chat(MESSAGES);

    expect(requestedModels()).toEqual(['claude-haiku-4-5']);
  });
});
