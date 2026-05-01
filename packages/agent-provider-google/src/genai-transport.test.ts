import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TUniversalMessage } from '@robota-sdk/agent-core';

const generateContentMock = vi.fn();
const generateContentStreamMock = vi.fn();
const genAiConstructorMock = vi.fn();

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    public readonly models = {
      generateContent: generateContentMock,
      generateContentStream: generateContentStreamMock,
    };

    public constructor(options: { apiKey: string }) {
      genAiConstructorMock(options);
    }
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

function createUserMessage(content: string): TUniversalMessage {
  return {
    id: 'msg-1',
    state: 'complete' as const,
    role: 'user',
    content,
    timestamp: new Date(),
  };
}

describe('GoogleProvider @google/genai transport', () => {
  beforeEach(() => {
    vi.resetModules();
    generateContentMock.mockReset();
    generateContentStreamMock.mockReset();
    genAiConstructorMock.mockClear();
  });

  it('uses GoogleGenAI models.generateContent with config payload shape', async () => {
    generateContentMock.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'done' }] } }],
    });
    const { GoogleProvider } = await import('./provider');

    const provider = new GoogleProvider({ apiKey: 'test-key' });
    const response = await provider.chat([createUserMessage('hello')], {
      model: 'gemini-3-flash-preview',
      temperature: 0.4,
      maxTokens: 128,
      tools: [
        {
          name: 'search',
          description: 'Search the web',
          parameters: { type: 'object', properties: { q: { type: 'string' } } },
        },
      ],
    });

    expect(response.content).toBe('done');
    expect(genAiConstructorMock).toHaveBeenCalledWith({ apiKey: 'test-key' });
    expect(generateContentMock).toHaveBeenCalledWith({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      config: {
        temperature: 0.4,
        maxOutputTokens: 128,
        responseModalities: ['TEXT'],
        tools: [
          {
            functionDeclarations: [
              {
                name: 'search',
                description: 'Search the web',
                parameters: { type: 'OBJECT', properties: { q: { type: 'STRING' } } },
              },
            ],
          },
        ],
      },
    });
  });

  it('uses GoogleGenAI models.generateContentStream as an async iterable', async () => {
    generateContentStreamMock.mockResolvedValue(
      (async function* () {
        yield { text: 'Hello' };
        yield { text: ' world' };
      })(),
    );
    const { GoogleProvider } = await import('./provider');

    const provider = new GoogleProvider({ apiKey: 'test-key' });
    const chunks: TUniversalMessage[] = [];
    for await (const chunk of provider.chatStream([createUserMessage('hello')], {
      model: 'gemini-3-flash-preview',
    })) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.content)).toEqual(['Hello', ' world']);
    expect(generateContentStreamMock).toHaveBeenCalledWith({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      config: {
        responseModalities: ['TEXT'],
      },
    });
  });
});
