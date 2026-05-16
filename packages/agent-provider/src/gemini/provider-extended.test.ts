import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GeminiProvider } from './provider';
import type {
  IProviderNativeRawPayloadEvent,
  TUniversalMessage,
  IExecutor,
} from '@robota-sdk/agent-core';

// Shared mock for generateContent and generateContentStream
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

function makeTextResponse(text: string) {
  return {
    candidates: [{ content: { parts: [{ text }] } }],
  };
}

function makeImageResponse(text: string, mimeType: string, data: string) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text }, { inlineData: { mimeType, data } }],
        },
      },
    ],
  };
}

describe('GeminiProvider - chat error paths', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
    generateContentStreamMock.mockReset();
  });

  it('throws when model and provider defaultModel are not specified', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    await expect(
      provider.chat(
        [
          {
            id: 'msg-1',
            state: 'complete' as const,
            role: 'user',
            content: 'hello',
            timestamp: new Date(),
          },
        ],
        {}, // no model
      ),
    ).rejects.toThrow('Google chat failed: Model is required');
  });

  it('uses provider defaultModel when options are undefined', async () => {
    generateContentMock.mockResolvedValue(makeTextResponse('done'));
    const provider = new GeminiProvider({ apiKey: 'test-key', defaultModel: 'gemini-pro' });
    const response = await provider.chat([
      {
        id: 'msg-1',
        state: 'complete' as const,
        role: 'user',
        content: 'hello',
        timestamp: new Date(),
      },
    ]);
    expect(response.content).toBe('done');
    expect(generateContentMock.mock.calls[0]?.[0].model).toBe('gemini-pro');
  });

  it('emits native Gemini request and response payloads before normalization', async () => {
    generateContentMock.mockResolvedValue(makeTextResponse('done'));
    const provider = new GeminiProvider({ apiKey: 'test-key', defaultModel: 'gemini-pro' });
    const events: IProviderNativeRawPayloadEvent[] = [];

    await provider.chat(
      [
        {
          id: 'msg-1',
          state: 'complete' as const,
          role: 'user',
          content: 'hello',
          timestamp: new Date(),
        },
      ],
      { onProviderNativeRawPayload: (event) => events.push(event) },
    );

    expect(events).toEqual([
      expect.objectContaining({
        provider: 'gemini',
        apiSurface: 'gemini-generate-content',
        payloadKind: 'request',
        payload: expect.objectContaining({ model: 'gemini-pro' }),
      }),
      expect.objectContaining({
        provider: 'gemini',
        apiSurface: 'gemini-generate-content',
        payloadKind: 'response',
        payload: expect.objectContaining({ candidates: expect.any(Array) }),
      }),
    ]);
  });

  it('passes tool messages as function responses', async () => {
    generateContentMock.mockResolvedValue(makeTextResponse('done'));
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    await provider.chat(
      [
        {
          id: 'msg-1',
          state: 'complete' as const,
          role: 'assistant',
          content: null,
          toolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"Seoul"}' },
            },
          ],
          timestamp: new Date(),
        },
        {
          id: 'msg-2',
          state: 'complete' as const,
          role: 'tool',
          content: '{"temperature":20}',
          toolCallId: 'call_1',
          name: 'get_weather',
          timestamp: new Date(),
        },
      ],
      { model: 'gemini-pro' },
    );
    expect(generateContentMock.mock.calls[0]?.[0].contents).toEqual([
      {
        role: 'model',
        parts: [
          {
            functionCall: {
              id: 'call_1',
              name: 'get_weather',
              args: { city: 'Seoul' },
            },
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'call_1',
              name: 'get_weather',
              response: { temperature: 20 },
            },
          },
        ],
      },
    ]);
  });

  it('wraps API errors in "Google chat failed" message', async () => {
    generateContentMock.mockRejectedValue(new Error('API quota exceeded'));
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    await expect(
      provider.chat(
        [
          {
            id: 'msg-1',
            state: 'complete' as const,
            role: 'user',
            content: 'hello',
            timestamp: new Date(),
          },
        ],
        {
          model: 'gemini-pro',
        },
      ),
    ).rejects.toThrow('Google chat failed: API quota exceeded');
  });

  it('wraps non-Error API failures', async () => {
    generateContentMock.mockRejectedValue('string error');
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    await expect(
      provider.chat(
        [
          {
            id: 'msg-1',
            state: 'complete' as const,
            role: 'user',
            content: 'hello',
            timestamp: new Date(),
          },
        ],
        {
          model: 'gemini-pro',
        },
      ),
    ).rejects.toThrow('Google chat failed: Google API request failed');
  });

  it('passes tools as function declarations', async () => {
    generateContentMock.mockResolvedValue(makeTextResponse('done'));
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    await provider.chat(
      [
        {
          id: 'msg-1',
          state: 'complete' as const,
          role: 'user',
          content: 'hello',
          timestamp: new Date(),
        },
      ],
      {
        model: 'gemini-pro',
        tools: [
          {
            name: 'search',
            description: 'Search the web',
            parameters: { type: 'object', properties: { q: { type: 'string' } } },
          },
        ],
      },
    );
    const payload = generateContentMock.mock.calls[0]?.[0];
    expect(payload.config.tools).toBeDefined();
    expect(payload.config.tools[0].functionDeclarations).toHaveLength(1);
    expect(payload.config.tools[0].functionDeclarations[0].name).toBe('search');
  });

  it('throws on IMAGE modality when response lacks image part', async () => {
    generateContentMock.mockResolvedValue(makeTextResponse('no image here'));
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    await expect(
      provider.chat(
        [
          {
            id: 'msg-1',
            state: 'complete' as const,
            role: 'user',
            content: 'create image',
            timestamp: new Date(),
          },
        ],
        {
          model: 'gemini-2.5-flash-image',
          google: { responseModalities: ['TEXT', 'IMAGE'] },
        },
      ),
    ).rejects.toThrow('Gemini response did not include an image part');
  });
});

describe('GeminiProvider - chatStream', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
    generateContentStreamMock.mockReset();
  });

  it('yields streaming text chunks', async () => {
    generateContentStreamMock.mockResolvedValue(
      (async function* () {
        yield { text: 'Hello' };
        yield { text: ' world' };
      })(),
    );

    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const chunks: TUniversalMessage[] = [];
    for await (const chunk of provider.chatStream(
      [
        {
          id: 'msg-1',
          state: 'complete' as const,
          role: 'user',
          content: 'hello',
          timestamp: new Date(),
        },
      ],
      { model: 'gemini-pro' },
    )) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.content).toBe('Hello');
    expect(chunks[1]?.content).toBe(' world');
    expect(chunks[0]?.role).toBe('assistant');
  });

  it('skips empty text chunks', async () => {
    generateContentStreamMock.mockResolvedValue(
      (async function* () {
        yield { text: '' };
        yield { text: 'data' };
      })(),
    );

    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const chunks: TUniversalMessage[] = [];
    for await (const chunk of provider.chatStream(
      [
        {
          id: 'msg-1',
          state: 'complete' as const,
          role: 'user',
          content: 'hello',
          timestamp: new Date(),
        },
      ],
      { model: 'gemini-pro' },
    )) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('data');
  });

  it('throws when IMAGE modality is requested in stream mode', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const iter = provider.chatStream(
      [
        {
          id: 'msg-1',
          state: 'complete' as const,
          role: 'user',
          content: 'hello',
          timestamp: new Date(),
        },
      ],
      {
        model: 'gemini-2.5-flash-image',
        google: { responseModalities: ['IMAGE'] },
      },
    );
    await expect(async () => {
      for await (const _chunk of iter) {
        // consume
      }
    }).rejects.toThrow('Google stream failed:');
  });

  it('throws when model is not specified', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const iter = provider.chatStream(
      [
        {
          id: 'msg-1',
          state: 'complete' as const,
          role: 'user',
          content: 'hello',
          timestamp: new Date(),
        },
      ],
      {}, // no model
    );
    await expect(async () => {
      for await (const _chunk of iter) {
        // consume
      }
    }).rejects.toThrow('Google stream failed:');
  });

  it('uses provider defaultModel in stream mode', async () => {
    generateContentStreamMock.mockResolvedValue(
      (async function* () {
        yield { text: 'ok' };
      })(),
    );
    const provider = new GeminiProvider({ apiKey: 'test-key', defaultModel: 'gemini-pro' });
    const chunks: TUniversalMessage[] = [];
    for await (const chunk of provider.chatStream([
      {
        id: 'msg-1',
        state: 'complete' as const,
        role: 'user',
        content: 'hello',
        timestamp: new Date(),
      },
    ])) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(1);
    expect(generateContentStreamMock.mock.calls[0]?.[0].model).toBe('gemini-pro');
  });

  it('streams chat() through onTextDelta and returns assembled text', async () => {
    generateContentStreamMock.mockResolvedValue(
      (async function* () {
        yield { text: 'Hello ' };
        yield { text: 'Gemini' };
      })(),
    );
    const onTextDelta = vi.fn();
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const response = await provider.chat(
      [
        {
          id: 'msg-1',
          state: 'complete' as const,
          role: 'user',
          content: 'hello',
          timestamp: new Date(),
        },
      ],
      { model: 'gemini-pro', onTextDelta },
    );
    expect(response.content).toBe('Hello Gemini');
    expect(onTextDelta).toHaveBeenNthCalledWith(1, 'Hello ');
    expect(onTextDelta).toHaveBeenNthCalledWith(2, 'Gemini');
  });

  it('emits ordered native Gemini stream chunks', async () => {
    generateContentStreamMock.mockResolvedValue(
      (async function* () {
        yield { text: 'Hello ' };
        yield { text: 'Gemini' };
      })(),
    );
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const events: IProviderNativeRawPayloadEvent[] = [];

    await provider.chat(
      [
        {
          id: 'msg-1',
          state: 'complete' as const,
          role: 'user',
          content: 'hello',
          timestamp: new Date(),
        },
      ],
      {
        model: 'gemini-pro',
        onTextDelta: vi.fn(),
        onProviderNativeRawPayload: (event) => events.push(event),
      },
    );

    expect(events.map((event) => event.payloadKind)).toEqual([
      'request',
      'stream_event',
      'stream_event',
    ]);
    expect(
      events.filter((event) => event.payloadKind === 'stream_event').map((event) => event.sequence),
    ).toEqual([0, 1]);
  });

  it('wraps stream errors', async () => {
    generateContentStreamMock.mockRejectedValue(new Error('network timeout'));
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const iter = provider.chatStream(
      [
        {
          id: 'msg-1',
          state: 'complete' as const,
          role: 'user',
          content: 'hello',
          timestamp: new Date(),
        },
      ],
      {
        model: 'gemini-pro',
      },
    );
    await expect(async () => {
      for await (const _chunk of iter) {
        // consume
      }
    }).rejects.toThrow('Google stream failed: network timeout');
  });

  it('passes tools in streaming request', async () => {
    generateContentStreamMock.mockResolvedValue(
      (async function* () {
        yield { text: 'ok' };
      })(),
    );
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const chunks: TUniversalMessage[] = [];
    for await (const chunk of provider.chatStream(
      [
        {
          id: 'msg-1',
          state: 'complete' as const,
          role: 'user',
          content: 'hello',
          timestamp: new Date(),
        },
      ],
      {
        model: 'gemini-pro',
        tools: [
          {
            name: 'fn',
            description: 'A function',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
    )) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(1);
    const payload = generateContentStreamMock.mock.calls[0]?.[0];
    expect(payload.config.tools).toBeDefined();
  });
});

describe('GeminiProvider - validateConfig and dispose', () => {
  it('returns true when client and apiKey exist', () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    expect(provider.validateConfig()).toBe(true);
  });

  it('returns false when apiKey is empty string', () => {
    const provider = new GeminiProvider({ apiKey: '' });
    expect(provider.validateConfig()).toBe(false);
  });

  it('supportsTools returns true', () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    expect(provider.supportsTools()).toBe(true);
  });

  it('dispose resolves without error', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    await expect(provider.dispose()).resolves.toBeUndefined();
  });
});

describe('GeminiProvider - constructor with executor', () => {
  it('uses executor instead of direct client', async () => {
    const mockExecutor: IExecutor = {
      executeChat: vi.fn().mockResolvedValue({
        role: 'assistant',
        content: 'executor response',
        timestamp: new Date(),
      }),
      supportsTools: () => false,
      validateConfig: () => true,
      name: 'mock-executor',
      version: '1.0.0',
    };
    const provider = new GeminiProvider({
      apiKey: 'placeholder',
      executor: mockExecutor,
    });
    const result = await provider.chat(
      [
        {
          id: 'msg-1',
          state: 'complete' as const,
          role: 'user',
          content: 'hello',
          timestamp: new Date(),
        },
      ],
      { model: 'gemini-pro' },
    );
    expect(result.content).toBe('executor response');
    expect(mockExecutor.executeChat).toHaveBeenCalledTimes(1);
  });

  it('delegates validateConfig to executor when configured', () => {
    const mockExecutor: IExecutor = {
      executeChat: vi.fn(),
      supportsTools: () => false,
      validateConfig: () => true,
      name: 'mock-executor',
      version: '1.0.0',
    };
    const provider = new GeminiProvider({
      apiKey: 'placeholder',
      executor: mockExecutor,
    });
    expect(provider.validateConfig()).toBe(true);
  });

  it('propagates executor chat errors', async () => {
    const mockExecutor: IExecutor = {
      executeChat: vi.fn().mockRejectedValue(new Error('executor failed')),
      supportsTools: () => false,
      validateConfig: () => true,
      name: 'mock-executor',
      version: '1.0.0',
    };
    const provider = new GeminiProvider({
      apiKey: 'placeholder',
      executor: mockExecutor,
    });
    await expect(
      provider.chat(
        [
          {
            id: 'msg-1',
            state: 'complete' as const,
            role: 'user',
            content: 'hello',
            timestamp: new Date(),
          },
        ],
        {
          model: 'gemini-pro',
        },
      ),
    ).rejects.toThrow('executor failed');
  });
});

describe('GeminiProvider - generateImage', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it('returns error for empty prompt', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.generateImage({ prompt: '', model: 'gemini-2.5-flash-image' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
      expect(result.error.message).toContain('non-empty prompt');
    }
  });

  it('returns error for whitespace-only prompt', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.generateImage({ prompt: '   ', model: 'gemini-2.5-flash-image' });
    expect(result.ok).toBe(false);
  });

  it('returns error for empty model', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.generateImage({ prompt: 'a cat', model: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
      expect(result.error.message).toContain('non-empty model');
    }
  });

  it('returns image result on success', async () => {
    generateContentMock.mockResolvedValue(makeImageResponse('generated', 'image/png', 'imgdata'));
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.generateImage({
      prompt: 'a cat',
      model: 'gemini-2.5-flash-image',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outputs).toHaveLength(1);
      expect(result.value.outputs[0]?.mimeType).toBe('image/png');
      expect(result.value.model).toBe('gemini-2.5-flash-image');
    }
  });

  it('returns upstream error when chat fails', async () => {
    generateContentMock.mockRejectedValue(new Error('API error'));
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.generateImage({
      prompt: 'a cat',
      model: 'gemini-2.5-flash-image',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_UPSTREAM_ERROR');
    }
  });

  it('returns upstream error when response has no image parts', async () => {
    generateContentMock.mockResolvedValue(makeTextResponse('no image'));
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    // Need to bypass the IMAGE modality check — the response must contain image
    // but this test validates runImageRequest when mapInlineImagePartsToMediaOutputs returns empty
    // Since chat() will throw first due to missing image, this exercises that path
    const result = await provider.generateImage({
      prompt: 'a cat',
      model: 'gemini-2.5-flash-image',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_UPSTREAM_ERROR');
    }
  });
});

describe('GeminiProvider - editImage', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it('returns error for empty prompt', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.editImage({
      prompt: '',
      model: 'gemini-2.5-flash-image',
      image: { kind: 'inline', mimeType: 'image/png', data: 'abc' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('non-empty prompt');
    }
  });

  it('returns error for empty model', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.editImage({
      prompt: 'make it blue',
      model: '',
      image: { kind: 'inline', mimeType: 'image/png', data: 'abc' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('non-empty model');
    }
  });

  it('returns error for invalid image source', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.editImage({
      prompt: 'make it blue',
      model: 'gemini-2.5-flash-image',
      image: { kind: 'inline', mimeType: '', data: 'abc' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
    }
  });

  it('returns image result on success', async () => {
    generateContentMock.mockResolvedValue(makeImageResponse('edited', 'image/png', 'newdata'));
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.editImage({
      prompt: 'make it blue',
      model: 'gemini-2.5-flash-image',
      image: { kind: 'inline', mimeType: 'image/png', data: 'original' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outputs).toHaveLength(1);
    }
  });

  it('handles URI image source with data URI', async () => {
    generateContentMock.mockResolvedValue(makeImageResponse('edited', 'image/jpeg', 'newdata'));
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.editImage({
      prompt: 'crop it',
      model: 'gemini-2.5-flash-image',
      image: { kind: 'uri', uri: 'data:image/jpeg;base64,originaldata' },
    });
    expect(result.ok).toBe(true);
  });

  it('returns error for non-data URI image source', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.editImage({
      prompt: 'crop it',
      model: 'gemini-2.5-flash-image',
      image: { kind: 'uri', uri: 'https://example.com/img.png' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
    }
  });
});

describe('GeminiProvider - composeImage', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it('returns error for empty prompt', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.composeImage({
      prompt: '',
      model: 'gemini-2.5-flash-image',
      images: [
        { kind: 'inline', mimeType: 'image/png', data: 'a' },
        { kind: 'inline', mimeType: 'image/png', data: 'b' },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('returns error for empty model', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.composeImage({
      prompt: 'merge these',
      model: '',
      images: [
        { kind: 'inline', mimeType: 'image/png', data: 'a' },
        { kind: 'inline', mimeType: 'image/png', data: 'b' },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('returns error for fewer than 2 images', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.composeImage({
      prompt: 'merge these',
      model: 'gemini-2.5-flash-image',
      images: [{ kind: 'inline', mimeType: 'image/png', data: 'a' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('at least two');
    }
  });

  it('returns error for empty images array', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.composeImage({
      prompt: 'merge these',
      model: 'gemini-2.5-flash-image',
      images: [],
    });
    expect(result.ok).toBe(false);
  });

  it('returns error when one of the image sources is invalid', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.composeImage({
      prompt: 'merge these',
      model: 'gemini-2.5-flash-image',
      images: [
        { kind: 'inline', mimeType: 'image/png', data: 'valid' },
        { kind: 'inline', mimeType: '', data: 'invalid' },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
    }
  });

  it('returns composed image result on success', async () => {
    generateContentMock.mockResolvedValue(
      makeImageResponse('composed', 'image/png', 'composed-data'),
    );
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const result = await provider.composeImage({
      prompt: 'merge these',
      model: 'gemini-2.5-flash-image',
      images: [
        { kind: 'inline', mimeType: 'image/png', data: 'img1' },
        { kind: 'inline', mimeType: 'image/png', data: 'img2' },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outputs).toHaveLength(1);
      expect(result.value.model).toBe('gemini-2.5-flash-image');
    }
  });
});

describe('GeminiProvider - name and version', () => {
  it('has name "gemini"', () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    expect(provider.name).toBe('gemini');
  });

  it('has version "1.0.0"', () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    expect(provider.version).toBe('1.0.0');
  });
});
