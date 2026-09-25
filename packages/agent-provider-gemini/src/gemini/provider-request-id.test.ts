import { describe, expect, it, vi, beforeEach } from 'vitest';

import { GeminiProvider } from './provider';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

const generateContentMock = vi.fn();
const generateContentStreamMock = vi.fn();

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    public readonly models = {
      generateContent: generateContentMock,
      generateContentStream: generateContentStreamMock,
    };

    public constructor(_options: { apiKey: string }) {}
  }
  return {
    GoogleGenAI,
    Type: {
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      INTEGER: 'INTEGER',
      BOOLEAN: 'BOOLEAN',
      ARRAY: 'ARRAY',
      OBJECT: 'OBJECT',
    },
  };
});

const inputMessages: TUniversalMessage[] = [
  {
    id: 'msg-1',
    state: 'complete' as const,
    role: 'user',
    content: 'hello',
    timestamp: new Date(),
  },
];

describe('GeminiProvider - provider request ID (non-stream)', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
    generateContentStreamMock.mockReset();
  });

  it('carries the Gemini responseId as metadata.providerRequestId when present', async () => {
    generateContentMock.mockResolvedValue({
      responseId: 'resp_abc123',
      candidates: [{ content: { parts: [{ text: 'hi' }] } }],
    });

    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.chat(inputMessages, { model: 'gemini-pro' });

    expect(result.metadata?.providerRequestId).toBe('resp_abc123');
  });

  it('leaves metadata.providerRequestId absent when the SDK returns no responseId', async () => {
    generateContentMock.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'hi' }] } }],
    });

    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.chat(inputMessages, { model: 'gemini-pro' });

    expect(result.metadata?.providerRequestId).toBeUndefined();
  });
});

describe('GeminiProvider - provider request ID (stream)', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
    generateContentStreamMock.mockReset();
  });

  it('carries the first non-empty responseId seen across stream chunks onto yielded messages', async () => {
    generateContentStreamMock.mockResolvedValue(
      (async function* () {
        yield { responseId: 'resp_stream_1', text: 'Hello' };
        yield { responseId: 'resp_stream_1', text: ' world' };
      })(),
    );

    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const chunks: TUniversalMessage[] = [];
    for await (const chunk of provider.chatStream(inputMessages, { model: 'gemini-pro' })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.metadata?.providerRequestId === 'resp_stream_1')).toBe(
      true,
    );
  });

  it('keeps the first responseId seen when later chunks disagree', async () => {
    generateContentStreamMock.mockResolvedValue(
      (async function* () {
        yield { responseId: 'resp_first', text: 'Hello' };
        yield { responseId: 'resp_second', text: ' world' };
      })(),
    );

    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const chunks: TUniversalMessage[] = [];
    for await (const chunk of provider.chatStream(inputMessages, { model: 'gemini-pro' })) {
      chunks.push(chunk);
    }

    expect(chunks.every((chunk) => chunk.metadata?.providerRequestId === 'resp_first')).toBe(true);
  });

  it('leaves metadata.providerRequestId absent when no chunk carries one', async () => {
    generateContentStreamMock.mockResolvedValue(
      (async function* () {
        yield { text: 'Hello' };
      })(),
    );

    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const chunks: TUniversalMessage[] = [];
    for await (const chunk of provider.chatStream(inputMessages, { model: 'gemini-pro' })) {
      chunks.push(chunk);
    }

    expect(chunks[0]?.metadata?.providerRequestId).toBeUndefined();
  });

  it('keeps complete usage metadata from an earlier chunk when a later chunk carries only the response ID', async () => {
    generateContentStreamMock.mockResolvedValue(
      (async function* () {
        yield {
          responseId: 'r1',
          candidates: [{ content: { parts: [{ text: 'checking' }] } }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        };
        yield {
          responseId: 'r1',
          candidates: [
            {
              content: {
                parts: [{ functionCall: { id: 'call_1', name: 'lookup', args: {} } }],
              },
            },
          ],
        };
      })(),
    );

    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.chat(inputMessages, {
      model: 'gemini-pro',
      onTextDelta: vi.fn(),
    });

    expect(result.metadata).toEqual({
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      usageProvenance: 'complete',
      providerRequestId: 'r1',
    });
  });

  it('carries the stream responseId onto the assembled message when chat() consumes onTextDelta', async () => {
    generateContentStreamMock.mockResolvedValue(
      (async function* () {
        yield { responseId: 'resp_assembled_1', text: 'Hello' };
        yield {
          responseId: 'resp_assembled_1',
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        };
      })(),
    );

    const provider = new GeminiProvider({ apiKey: 'test-key' });
    provider.onTextDelta = () => {};
    const result = await provider.chat(inputMessages, { model: 'gemini-pro' });

    expect(result.metadata?.providerRequestId).toBe('resp_assembled_1');
  });
});
