/**
 * A failed OpenAI call keeps the HTTP status and OpenAI's error type on every API surface, instead of
 * collapsing into a bare `Error` whose only trace of the status is its message text.
 */

import { ProviderError, RateLimitError } from '@robota-sdk/agent-core';
import { APIError } from 'openai';
import { describe, expect, it, vi } from 'vitest';

import { OpenAIProvider } from '../provider';

import type { TUniversalMessage } from '@robota-sdk/agent-core';
import type OpenAI from 'openai';

const messages: TUniversalMessage[] = [
  { id: '1', role: 'user', content: 'hi', state: 'complete', timestamp: new Date() },
];

function httpError(status: number, type: string): Error {
  return APIError.generate(status, { error: { type, message: `${type} happened` } }, undefined, {});
}

function providerWith(apiSurface: 'chat-completions' | 'responses', error: Error): OpenAIProvider {
  const create = vi.fn().mockRejectedValue(error);
  const client = { chat: { completions: { create } }, responses: { create } };
  return new OpenAIProvider({ client: client as unknown as OpenAI, apiSurface });
}

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

const surfaces = ['chat-completions', 'responses'] as const;
const statuses: Array<[number, string]> = [
  [529, 'overloaded_error'],
  [503, 'server_error'],
  [500, 'server_error'],
  [401, 'invalid_api_key'],
];

describe('OpenAI provider errors', () => {
  for (const surface of surfaces) {
    it.each(statuses)(`${surface} chat keeps HTTP %i`, async (status, type) => {
      const provider = providerWith(surface, httpError(status, type));
      const error = await failure(() => provider.chat(messages, { model: 'gpt-4o' }));
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).status).toBe(status);
      expect((error as ProviderError).type).toBe(type);
      expect(error.message).toContain(`${status}`);
    });

    it(`${surface} chatStream keeps HTTP 503`, async () => {
      const provider = providerWith(surface, httpError(503, 'server_error'));
      const error = await failure(() => drain(provider.chatStream(messages, { model: 'gpt-4o' })));
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).status).toBe(503);
    });

    it(`${surface} chat maps 429 to RateLimitError`, async () => {
      const provider = providerWith(surface, httpError(429, 'rate_limit_exceeded'));
      const error = await failure(() => provider.chat(messages, { model: 'gpt-4o' }));
      expect(error).toBeInstanceOf(RateLimitError);
    });
  }
});
