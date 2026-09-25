/**
 * A failed call to an OpenAI-compatible vendor keeps the HTTP status and the vendor's error type,
 * on every provider and API surface here, instead of collapsing into a bare `Error`.
 */

import { ProviderError, RateLimitError } from '@robota-sdk/agent-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DeepSeekProvider, GemmaProvider, QwenProvider } from './index';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

const create = vi.fn();

vi.mock('openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openai')>();
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: { completions: { create } },
    responses: { create },
  }));
  return { ...actual, default: MockOpenAI };
});

const { APIError } = await vi.importActual<typeof import('openai')>('openai');

const messages: TUniversalMessage[] = [
  { id: '1', role: 'user', content: 'hi', state: 'complete', timestamp: new Date() },
];

function httpError(status: number, type: string): Error {
  return APIError.generate(status, { error: { type, message: `${type} happened` } }, undefined, {});
}

interface IChatProvider {
  chat(messages: TUniversalMessage[], options: { model: string }): Promise<unknown>;
  chatStream(
    messages: TUniversalMessage[],
    options: { model: string },
  ): AsyncIterable<TUniversalMessage>;
}

const providers: Array<[string, () => IChatProvider, string]> = [
  ['deepseek', () => new DeepSeekProvider({ apiKey: 'k' }), 'deepseek-chat'],
  ['gemma', () => new GemmaProvider({ apiKey: 'k', baseURL: 'http://localhost:1' }), 'gemma-4'],
  ['qwen chat-completions', () => new QwenProvider({ apiKey: 'k' }), 'qwen3.6-plus'],
  [
    'qwen responses',
    () => new QwenProvider({ apiKey: 'k', builtInWebTools: { webSearch: true } }),
    'qwen3.6-plus',
  ],
];

async function failure(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the call to fail');
}

async function drain(stream: AsyncIterable<TUniversalMessage>): Promise<void> {
  for await (const chunk of stream) void chunk;
}

describe('OpenAI-compatible provider errors', () => {
  beforeEach(() => {
    create.mockReset();
  });

  for (const [label, makeProvider, model] of providers) {
    it.each([
      [529, 'overloaded_error'],
      [503, 'server_error'],
      [500, 'server_error'],
      [401, 'invalid_api_key'],
    ])(`${label} chat keeps HTTP %i`, async (status, type) => {
      create.mockRejectedValue(httpError(status, type));
      const error = await failure(() => makeProvider().chat(messages, { model }));
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).status).toBe(status);
      expect((error as ProviderError).type).toBe(type);
    });

    it(`${label} chatStream keeps HTTP 503`, async () => {
      create.mockRejectedValue(httpError(503, 'server_error'));
      const error = await failure(() => drain(makeProvider().chatStream(messages, { model })));
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).status).toBe(503);
    });

    it(`${label} chat maps 429 to RateLimitError`, async () => {
      create.mockRejectedValue(httpError(429, 'rate_limit_exceeded'));
      const error = await failure(() => makeProvider().chat(messages, { model }));
      expect(error).toBeInstanceOf(RateLimitError);
    });
  }
});
