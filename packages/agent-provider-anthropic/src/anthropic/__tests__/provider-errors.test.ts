/**
 * A failed Anthropic call keeps the HTTP status and Anthropic's error type, on both paths, and a
 * mid-stream SSE `error` event (no HTTP status) keeps its `overloaded_error` type.
 */

import { ProviderError, RateLimitError, classifyProviderFailure } from '@robota-sdk/agent-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({ messages: { create: vi.fn() } })),
}));

import Anthropic from '@anthropic-ai/sdk';

import { AnthropicProvider } from '../provider';

const { APIError, APIUserAbortError, APIConnectionError } =
  await vi.importActual<typeof import('@anthropic-ai/sdk')>('@anthropic-ai/sdk');

const MODEL = 'claude-3-opus-20240229';
const messages: TUniversalMessage[] = [
  { id: '1', role: 'user', content: 'hi', state: 'complete', timestamp: new Date() },
];

function httpError(status: number, type: string): Error {
  return APIError.generate(
    status,
    { type: 'error', error: { type, message: `${type} happened` } },
    undefined,
    new Headers(),
  );
}

/** What the SDK throws for an SSE `error` event: an `APIError` with no status. */
function sseErrorEvent(type: 'overloaded_error'): Error {
  const body = { type: 'error', error: { type, message: 'Overloaded' } };
  return new APIError(undefined, body, undefined, new Headers(), type);
}

function streamThatFails(error: Error): AsyncIterable<Record<string, unknown>> {
  let sent = false;
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (!sent) {
            sent = true;
            return Promise.resolve({
              value: { type: 'message_start', message: { usage: {}, model: MODEL } },
              done: false,
            });
          }
          return Promise.reject(error);
        },
      };
    },
  };
}

async function drain(stream: AsyncIterable<TUniversalMessage>): Promise<void> {
  for await (const chunk of stream) void chunk;
}

async function failure(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the call to fail');
}

describe('Anthropic provider errors', () => {
  let create: ReturnType<typeof vi.fn>;
  let provider: AnthropicProvider;

  beforeEach(() => {
    create = vi.fn();
    provider = new AnthropicProvider({ client: { messages: { create } } as unknown as Anthropic });
  });

  it.each([
    [529, 'overloaded_error'],
    [503, 'api_error'],
    [500, 'api_error'],
    [401, 'authentication_error'],
  ])('chat keeps HTTP %i as a ProviderError status', async (status, type) => {
    create.mockRejectedValue(httpError(status, type));
    const error = await failure(() => provider.chat(messages, { model: MODEL }));
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).status).toBe(status);
    expect((error as ProviderError).type).toBe(type);
  });

  it('passes the SDK abort error through unchanged and classifies it as aborted', async () => {
    const abort = new APIUserAbortError();
    create.mockRejectedValue(abort);
    const error = await failure(() => provider.chat(messages, { model: MODEL }));
    expect(error).toBe(abort);
    expect(classifyProviderFailure(error)).toEqual({ switchable: false, reason: 'aborted' });
  });

  it('classifies an SDK connection failure as network', async () => {
    create.mockRejectedValue(
      new APIConnectionError({
        message: 'Connection error.',
        cause: new TypeError('fetch failed'),
      }),
    );
    const error = await failure(() => provider.chat(messages, { model: MODEL }));
    expect(error).toBeInstanceOf(ProviderError);
    expect(classifyProviderFailure(error)).toEqual({ switchable: false, reason: 'network' });
  });

  it('chat maps 429 to RateLimitError', async () => {
    create.mockRejectedValue(httpError(429, 'rate_limit_error'));
    const error = await failure(() => provider.chat(messages, { model: MODEL }));
    expect(error).toBeInstanceOf(RateLimitError);
  });

  it('chatStream keeps the status of a failed request', async () => {
    create.mockRejectedValue(httpError(503, 'api_error'));
    const error = await failure(() => drain(provider.chatStream(messages, { model: MODEL })));
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).status).toBe(503);
  });

  it('chatStream surfaces a mid-stream overloaded_error event as a switchable ProviderError', async () => {
    create.mockResolvedValue(streamThatFails(sseErrorEvent('overloaded_error')));
    const error = await failure(() => drain(provider.chatStream(messages, { model: MODEL })));
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).status).toBeUndefined();
    expect((error as ProviderError).type).toBe('overloaded_error');
    expect(classifyProviderFailure(error)).toEqual({ switchable: true, reason: 'overloaded' });
  });

  it('chat surfaces a mid-stream overloaded_error event the same way', async () => {
    create.mockResolvedValue(streamThatFails(sseErrorEvent('overloaded_error')));
    const error = await failure(() => provider.chat(messages, { model: MODEL }));
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).type).toBe('overloaded_error');
  });
});
