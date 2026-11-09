import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProviderDefinitionConfig, TUniversalMessage } from '@robota-sdk/agent-core';

const create = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({ messages: { create } })),
}));

import { createAnthropicProviderDefinition } from '../provider-definition.js';

const MODEL = 'claude-sonnet-4-6';

function profile(options?: IProviderDefinitionConfig['options']): IProviderDefinitionConfig {
  return {
    name: 'anthropic',
    model: MODEL,
    apiKey: 'sk-ant-test',
    ...(options !== undefined && { options }),
  };
}

const messages: TUniversalMessage[] = [
  { id: 'm1', role: 'user', content: 'hello', state: 'complete', timestamp: new Date() },
];

function textStream(): AsyncIterable<Record<string, unknown>> {
  return (async function* () {
    yield { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } };
    yield { type: 'content_block_start', index: 0, content_block: { type: 'text' } };
    yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } };
    yield { type: 'content_block_stop', index: 0 };
    yield {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 1 },
    };
    yield { type: 'message_stop' };
  })();
}

describe('Anthropic profile option nativeWebTools', () => {
  beforeEach(() => {
    create.mockReset();
    create.mockImplementation(async () => textStream());
  });

  it('leaves server web search off for a profile without the option', async () => {
    const provider = createAnthropicProviderDefinition().createProvider(profile());

    expect(provider.getCapabilities?.().nativeWebTools.webSearch.enabled).toBe(false);
    await provider.chat(messages, { model: MODEL });
    expect(JSON.stringify(create.mock.calls[0]?.[0]?.tools ?? [])).not.toContain('web_search');
  });

  it('enables server web search and sends the web_search tool when the profile asks for it', async () => {
    const provider = createAnthropicProviderDefinition().createProvider(
      profile({ nativeWebTools: { webSearch: true } }),
    );

    expect(provider.getCapabilities?.().nativeWebTools.webSearch.enabled).toBe(true);
    await provider.chat(messages, { model: MODEL });
    expect(create.mock.calls[0]?.[0]?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'web_search_20250305', name: 'web_search' }),
      ]),
    );
  });

  it('keeps server web search off when the profile sets webSearch to false', () => {
    const provider = createAnthropicProviderDefinition().createProvider(
      profile({ nativeWebTools: { webSearch: false, webFetch: false } }),
    );

    expect(provider.getCapabilities?.().nativeWebTools.webSearch.enabled).toBe(false);
  });

  it.each([
    ['a non-object value', { nativeWebTools: true }, 'must be an object'],
    ['null', { nativeWebTools: null }, 'must be an object'],
    ['an array', { nativeWebTools: [true] }, 'must be an object'],
    [
      'a non-boolean webSearch',
      { nativeWebTools: { webSearch: 'yes' } },
      'webSearch must be a boolean',
    ],
    ['a misspelled key', { nativeWebTools: { websearch: true } }, 'unknown key "websearch"'],
    [
      'webFetch enabled',
      { nativeWebTools: { webFetch: true } },
      'does not support native web fetch',
    ],
  ])('rejects %s', (_label, options, message) => {
    expect(() => createAnthropicProviderDefinition().createProvider(profile(options))).toThrow(
      message,
    );
  });
});
