/**
 * A failed Gemini call keeps the HTTP status the SDK's `ApiError` carries, instead of collapsing into
 * a bare `Error` whose only trace of the status is its message text.
 */

import { ProviderError, RateLimitError } from '@robota-sdk/agent-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GeminiProvider } from './provider';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

const generateContent = vi.fn();
const generateContentStream = vi.fn();

vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>();
  class GoogleGenAI {
    public readonly models = { generateContent, generateContentStream };
    public constructor(_options: { apiKey: string }) {}
  }
  return { ...actual, GoogleGenAI };
});

const { ApiError } = await vi.importActual<typeof import('@google/genai')>('@google/genai');

const messages: TUniversalMessage[] = [
  { id: '1', role: 'user', content: 'hi', state: 'complete', timestamp: new Date() },
];

function apiError(status: number): Error {
  return new ApiError({
    status,
    message: JSON.stringify({ error: { code: status, message: 'failed' } }),
  });
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

describe('Gemini provider errors', () => {
  beforeEach(() => {
    generateContent.mockReset();
    generateContentStream.mockReset();
  });

  it.each([529, 503, 500, 401])('chat keeps HTTP %i as a ProviderError status', async (status) => {
    generateContent.mockRejectedValue(apiError(status));
    generateContentStream.mockRejectedValue(apiError(status));
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const error = await failure(() => provider.chat(messages, { model: 'gemini-pro' }));
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).status).toBe(status);
    expect(error.message).toContain('Google chat failed');
  });

  it('chatStream keeps HTTP 503', async () => {
    generateContentStream.mockRejectedValue(apiError(503));
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const error = await failure(() =>
      drain(provider.chatStream(messages, { model: 'gemini-pro' })),
    );
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).status).toBe(503);
  });

  it('chat maps 429 to RateLimitError', async () => {
    generateContent.mockRejectedValue(apiError(429));
    generateContentStream.mockRejectedValue(apiError(429));
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const error = await failure(() => provider.chat(messages, { model: 'gemini-pro' }));
    expect(error).toBeInstanceOf(RateLimitError);
  });
});
