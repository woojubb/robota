import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GoogleProvider } from './provider';
import type { TUniversalMessage } from '@robota-sdk/agent-core';

interface IGenerateContentInput {
  contents: Array<{
    role: 'user' | 'model';
    parts: Array<{
      text?: string;
      inlineData?: {
        mimeType: string;
        data: string;
      };
      functionCall?: {
        name: string;
        args: Record<string, any>;
      };
    }>;
  }>;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    responseModalities?: Array<'TEXT' | 'IMAGE'>;
  };
}

const generateContentMock = vi.fn<
  [IGenerateContentInput],
  Promise<{
    response: {
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
    };
  }>
>();

vi.mock('@google/generative-ai', () => {
  class GoogleGenerativeAI {
    public constructor(_apiKey: string) {}

    public getGenerativeModel(_options: { model: string }): {
      generateContent: (input: IGenerateContentInput) => ReturnType<typeof generateContentMock>;
      generateContentStream: () => AsyncIterable<{ text: () => string }>;
    } {
      return {
        generateContent: generateContentMock,
        async *generateContentStream(): AsyncIterable<{ text: () => string }> {
          yield { text: () => '' };
        },
      };
    }
  }
  return { GoogleGenerativeAI };
});

describe('GoogleProvider image support', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it('maps inline image output from Gemini response to assistant parts', async () => {
    generateContentMock.mockResolvedValue({
      response: {
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
      },
    });

    const provider = new GoogleProvider({ apiKey: 'test-key' });
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
      response: {
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
      },
    });

    const provider = new GoogleProvider({ apiKey: 'test-key' });
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
    expect(calledPayload.generationConfig?.responseModalities).toEqual(['TEXT', 'IMAGE']);
  });

  it('throws when image modality is requested with non-image model', async () => {
    const provider = new GoogleProvider({ apiKey: 'test-key' });

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
    const provider = new GoogleProvider({ apiKey: 'test-key' });

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
