import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GeminiProvider } from './provider';
import type { TUniversalMessage } from '@robota-sdk/agent-core';

interface IGenerateContentInput {
  model: string;
  contents: Array<{
    role: 'user' | 'model';
    parts: Array<{
      text?: string;
      inlineData?: {
        mimeType: string;
        data: string;
      };
      functionCall?: {
        id?: string;
        name: string;
        args: Record<string, string | number | boolean | object>;
      };
    }>;
  }>;
  config?: {
    temperature?: number;
    maxOutputTokens?: number;
    responseModalities?: Array<'TEXT' | 'IMAGE'>;
  };
}

const generateContentMock = vi.fn<
  [IGenerateContentInput],
  Promise<{
    candidates: Array<{
      content: {
        parts: Array<{
          text?: string;
          inlineData?: {
            mimeType: string;
            data: string;
          };
        }>;
      };
    }>;
  }>
>();

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    public readonly models = {
      generateContent: generateContentMock,
      async *generateContentStream(): AsyncIterable<{ text: string }> {
        yield { text: '' };
      },
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

describe('GeminiProvider image support', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it('maps inline image output from Gemini response to assistant parts', async () => {
    generateContentMock.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              { text: 'created' },
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: 'ZmFrZS1pbWFnZS1kYXRh',
                },
              },
            ],
          },
        },
      ],
    });

    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const response = await provider.chat(
      [
        {
          id: 'msg-1',
          state: 'complete' as const,
          role: 'user',
          content: 'create an image',
          timestamp: new Date(),
        },
      ],
      {
        model: 'gemini-2.5-flash-image',
        google: { responseModalities: ['TEXT', 'IMAGE'] },
      },
    );

    expect(response.role).toBe('assistant');
    expect(response.parts).toBeDefined();
    expect(response.parts?.some((part) => part.type === 'image_inline')).toBe(true);
  });

  it('maps inline image input parts into Gemini inlineData request parts', async () => {
    generateContentMock.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              { text: 'ok' },
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: 'ZmFrZS1pbWFnZS1kYXRh',
                },
              },
            ],
          },
        },
      ],
    });

    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const messages: TUniversalMessage[] = [
      {
        id: 'msg-1',
        state: 'complete' as const,
        role: 'user',
        content: '',
        parts: [
          {
            type: 'image_inline',
            mimeType: 'image/png',
            data: 'ZmFrZS1pbWFnZS1pbnB1dA==',
          },
          {
            type: 'text',
            text: 'edit this image',
          },
        ],
        timestamp: new Date(),
      },
    ];

    await provider.chat(messages, {
      model: 'gemini-2.5-flash-image',
    });

    const calledPayload = generateContentMock.mock.calls[0]?.[0];
    expect(calledPayload.contents[0]?.parts[0]?.inlineData?.mimeType).toBe('image/png');
    expect(calledPayload.contents[0]?.parts[1]?.text).toBe('edit this image');
    expect(calledPayload.config?.responseModalities).toEqual(['TEXT', 'IMAGE']);
  });

  it('throws when image modality is requested with non-image model', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });

    await expect(
      provider.chat(
        [
          {
            id: 'msg-1',
            state: 'complete' as const,
            role: 'user',
            content: 'generate image',
            timestamp: new Date(),
          },
        ],
        {
          model: 'gemini-1.5-pro',
          google: { responseModalities: ['IMAGE'] },
        },
      ),
    ).rejects.toThrow('Google chat failed:');
  });

  it('throws when image uri message part is used directly', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });

    await expect(
      provider.chat(
        [
          {
            id: 'msg-1',
            state: 'complete' as const,
            role: 'user',
            content: '',
            parts: [
              {
                type: 'image_uri',
                uri: 'asset://example',
                mimeType: 'image/png',
              },
            ],
            timestamp: new Date(),
          },
        ],
        {
          model: 'gemini-2.5-flash-image',
        },
      ),
    ).rejects.toThrow('Google chat failed:');
  });
});
