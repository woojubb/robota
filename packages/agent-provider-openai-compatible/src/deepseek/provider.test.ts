import { beforeEach, describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import type {
  IAssistantMessage,
  IExecutor,
  IProviderNativeRawPayloadEvent,
  IToolSchema,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import { DEFAULT_DEEPSEEK_PROVIDER_BASE_URL, DeepSeekProvider } from './index';

vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  }));
  return { default: MockOpenAI };
});

const timestamp = new Date('2026-05-01T00:00:00.000Z');

interface IOpenAIClientMock {
  chat: {
    completions: {
      create: ReturnType<typeof vi.fn>;
    };
  };
}

function getClient(provider: DeepSeekProvider): IOpenAIClientMock {
  return (provider as unknown as { client: IOpenAIClientMock }).client;
}

function createUserMessage(content: string): TUniversalMessage {
  return {
    id: 'user-1',
    role: 'user',
    content,
    state: 'complete',
    timestamp,
  };
}

function createToolSchema(): IToolSchema {
  return {
    name: 'inspect_file',
    description: 'Inspect a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    },
  };
}

async function* asyncIterableFrom<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

function createChunk(
  content: string,
  finishReason: OpenAI.Chat.ChatCompletionChunk.Choice['finish_reason'] = null,
): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'deepseek-v4-flash',
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
  };
}

describe('DeepSeekProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an OpenAI-compatible client with DeepSeek endpoint options', async () => {
    const OpenAIModule = await import('openai');
    const OpenAIConstructor = vi.mocked(OpenAIModule.default);

    const provider = new DeepSeekProvider({
      apiKey: 'deepseek-key',
      baseURL: 'https://api.deepseek.com',
      timeout: 1000,
    });

    expect(provider.name).toBe('deepseek');
    expect(OpenAIConstructor).toHaveBeenCalledWith({
      apiKey: 'deepseek-key',
      baseURL: 'https://api.deepseek.com',
      timeout: 1000,
    });
  });

  it('uses the documented DeepSeek OpenAI-compatible base URL by default', async () => {
    const OpenAIModule = await import('openai');
    const OpenAIConstructor = vi.mocked(OpenAIModule.default);

    new DeepSeekProvider({
      apiKey: 'deepseek-key',
    });

    expect(OpenAIConstructor).toHaveBeenCalledWith({
      apiKey: 'deepseek-key',
      baseURL: DEFAULT_DEEPSEEK_PROVIDER_BASE_URL,
    });
  });

  it('unwraps executor chat and stream envelopes', async () => {
    const message: IAssistantMessage = {
      ...createUserMessage('from executor'),
      role: 'assistant',
    };
    const executor: IExecutor = {
      executeChat: vi.fn().mockResolvedValue({ message }),
      executeChatStream: vi.fn().mockImplementation(async function* () {
        yield { kind: 'message' as const, message };
        yield { kind: 'terminal' as const };
      }),
      supportsTools: () => true,
      validateConfig: () => true,
      name: 'mock-executor',
      version: '1.0.0',
    };
    const provider = new DeepSeekProvider({ executor });

    await expect(
      provider.chat([createUserMessage('hello')], { model: 'deepseek-v4-flash' }),
    ).resolves.toBe(message);
    const streamed: TUniversalMessage[] = [];
    for await (const chunk of provider.chatStream([createUserMessage('hello')], {
      model: 'deepseek-v4-flash',
    })) {
      streamed.push(chunk);
    }
    expect(streamed).toEqual([message]);
  });

  it('sends OpenAI-compatible messages, tools, and DeepSeek thinking controls', async () => {
    const provider = new DeepSeekProvider({
      apiKey: 'deepseek-key',
      thinking: 'enabled',
      reasoningEffort: 'high',
    });
    const client = getClient(provider);
    client.chat.completions.create.mockResolvedValue({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1,
      model: 'deepseek-v4-pro',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '',
            refusal: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'inspect_file',
                  arguments: '{"path":"README.md"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 4,
        total_tokens: 14,
      },
    } satisfies OpenAI.Chat.ChatCompletion);

    const result = await provider.chat([createUserMessage('Inspect README')], {
      model: 'deepseek-v4-pro',
      tools: [createToolSchema()],
    });

    expect(client.chat.completions.create).toHaveBeenCalledWith({
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: 'Inspect README' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'inspect_file',
            description: 'Inspect a file',
            parameters: createToolSchema().parameters,
          },
        },
      ],
      tool_choice: 'auto',
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    });
    if (result.role !== 'assistant') throw new Error('Expected assistant message');
    expect(result.toolCalls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'inspect_file',
          arguments: '{"path":"README.md"}',
        },
      },
    ]);
  });

  it('emits native Chat Completions request and response payloads', async () => {
    const provider = new DeepSeekProvider({ apiKey: 'deepseek-key' });
    const client = getClient(provider);
    client.chat.completions.create.mockResolvedValue({
      id: 'deepseek-chat-native',
      object: 'chat.completion',
      created: 1,
      model: 'deepseek-v4-flash',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'native', refusal: null },
          finish_reason: 'stop',
          logprobs: null,
        },
      ],
    } satisfies OpenAI.Chat.ChatCompletion);
    const events: IProviderNativeRawPayloadEvent[] = [];

    await provider.chat([createUserMessage('Hello')], {
      model: 'deepseek-v4-flash',
      onProviderNativeRawPayload: (event) => events.push(event),
    });

    expect(events).toEqual([
      expect.objectContaining({
        provider: 'deepseek',
        apiSurface: 'chat-completions',
        payloadKind: 'request',
      }),
      expect.objectContaining({
        provider: 'deepseek',
        apiSurface: 'chat-completions',
        payloadKind: 'response',
        payload: expect.objectContaining({ id: 'deepseek-chat-native' }),
      }),
    ]);
  });

  // TC-03 (runtime half): DeepSeek has no native per-call reasoning-effort param.
  // A populated `effort` must complete without throwing AND must not appear on the
  // built Chat Completions request.
  it('TC-03: ignores per-call effort without error and emits no effort param', async () => {
    const provider = new DeepSeekProvider({ apiKey: 'deepseek-key' });
    const client = getClient(provider);
    client.chat.completions.create.mockResolvedValue({
      id: 'deepseek-effort-noop',
      object: 'chat.completion',
      created: 1,
      model: 'deepseek-v4-flash',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'noop', refusal: null },
          finish_reason: 'stop',
          logprobs: null,
        },
      ],
    } satisfies OpenAI.Chat.ChatCompletion);

    const result = await provider.chat([createUserMessage('Hello')], {
      model: 'deepseek-v4-flash',
      effort: 'max',
    });

    expect(result.role).toBe('assistant');
    const [requestParams] = client.chat.completions.create.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(requestParams).not.toHaveProperty('effort');
    expect(requestParams).not.toHaveProperty('reasoning_effort');
  });

  it('uses streaming assembly when text deltas are requested', async () => {
    const provider = new DeepSeekProvider({ apiKey: 'deepseek-key' });
    const client = getClient(provider);
    client.chat.completions.create.mockResolvedValue(
      asyncIterableFrom([
        createChunk('Hello'),
        createChunk(' from '),
        createChunk('DeepSeek', 'stop'),
      ]),
    );
    const onTextDelta = vi.fn();

    const result = await provider.chat([createUserMessage('Hello')], {
      model: 'deepseek-v4-flash',
      onTextDelta,
    });

    expect(client.chat.completions.create).toHaveBeenCalledWith(
      {
        model: 'deepseek-v4-flash',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      },
      undefined,
    );
    expect(onTextDelta).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onTextDelta).toHaveBeenNthCalledWith(2, ' from ');
    expect(onTextDelta).toHaveBeenNthCalledWith(3, 'DeepSeek');
    expect(result.content).toBe('Hello from DeepSeek');
  });

  it('reports function calling without provider-native web tools', () => {
    const provider = new DeepSeekProvider({ apiKey: 'deepseek-key' });

    expect(provider.getCapabilities()).toEqual({
      functionCalling: { supported: true },
      nativeWebTools: {
        webSearch: {
          supported: false,
          enabled: false,
          source: 'openai-compatible-chat-completions',
          reason:
            'DeepSeek OpenAI-compatible Chat Completions supports declared function tools, not provider-native web search.',
        },
        webFetch: {
          supported: false,
          enabled: false,
          source: 'openai-compatible-chat-completions',
          reason:
            'DeepSeek OpenAI-compatible Chat Completions supports declared function tools, not provider-native web fetch.',
        },
      },
    });
  });

  it('yields universal assistant messages from direct chatStream chunks', async () => {
    const provider = new DeepSeekProvider({ apiKey: 'deepseek-key' });
    const client = getClient(provider);
    client.chat.completions.create.mockResolvedValue(
      asyncIterableFrom([createChunk('Part one'), createChunk(' done', 'stop')]),
    );

    const chunks: TUniversalMessage[] = [];
    for await (const chunk of provider.chatStream?.([createUserMessage('Stream')], {
      model: 'deepseek-v4-flash',
    }) ?? []) {
      chunks.push(chunk);
    }

    expect(client.chat.completions.create).toHaveBeenCalledWith({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'Stream' }],
      stream: true,
    });
    expect(chunks.map((chunk) => chunk.content)).toEqual(['Part one', ' done']);
    expect(chunks[1]?.metadata?.['isComplete']).toBe(true);
  });

  it('carries the server-returned request ID (response._request_id) onto metadata', async () => {
    const provider = new DeepSeekProvider({ apiKey: 'deepseek-key' });
    const client = getClient(provider);
    client.chat.completions.create.mockResolvedValue({
      id: 'deepseek-req-id',
      _request_id: 'req_deepseek_123',
      object: 'chat.completion',
      created: 1,
      model: 'deepseek-v4-flash',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'hi', refusal: null },
          finish_reason: 'stop',
          logprobs: null,
        },
      ],
    } satisfies OpenAI.Chat.ChatCompletion & { _request_id: string });

    const result = await provider.chat([createUserMessage('Hello')], {
      model: 'deepseek-v4-flash',
    });

    expect(result.metadata?.['providerRequestId']).toBe('req_deepseek_123');
  });

  it('never fabricates a request ID when the response has no _request_id', async () => {
    const provider = new DeepSeekProvider({ apiKey: 'deepseek-key' });
    const client = getClient(provider);
    client.chat.completions.create.mockResolvedValue({
      id: 'deepseek-no-req-id',
      object: 'chat.completion',
      created: 1,
      model: 'deepseek-v4-flash',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'hi', refusal: null },
          finish_reason: 'stop',
          logprobs: null,
        },
      ],
    } satisfies OpenAI.Chat.ChatCompletion);

    const result = await provider.chat([createUserMessage('Hello')], {
      model: 'deepseek-v4-flash',
    });

    expect(result.metadata?.['providerRequestId']).toBeUndefined();
  });

  it('carries the server-returned request ID onto every yielded chunk when withResponse is available', async () => {
    const provider = new DeepSeekProvider({ apiKey: 'deepseek-key' });
    const client = getClient(provider);
    const stream = asyncIterableFrom([createChunk('Part one'), createChunk(' done', 'stop')]);
    client.chat.completions.create.mockReturnValue({
      then: (resolve: (value: unknown) => void) => resolve(stream),
      withResponse: async () => ({ data: stream, request_id: 'req_deepseek_stream' }),
    });

    const chunks: TUniversalMessage[] = [];
    for await (const chunk of provider.chatStream?.([createUserMessage('Stream')], {
      model: 'deepseek-v4-flash',
    }) ?? []) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(
      chunks.every((chunk) => chunk.metadata?.['providerRequestId'] === 'req_deepseek_stream'),
    ).toBe(true);
  });

  it('carries the server-returned request ID onto the assembled streaming message when withResponse is available', async () => {
    const provider = new DeepSeekProvider({ apiKey: 'deepseek-key' });
    const client = getClient(provider);
    const stream = asyncIterableFrom([
      createChunk('Hello'),
      createChunk(' from DeepSeek', 'stop'),
    ]);
    client.chat.completions.create.mockReturnValue({
      then: (resolve: (value: unknown) => void) => resolve(stream),
      withResponse: async () => ({ data: stream, request_id: 'req_deepseek_assembly' }),
    });

    const result = await provider.chat([createUserMessage('Hello')], {
      model: 'deepseek-v4-flash',
      onTextDelta: () => {},
    });

    expect(result.metadata?.['providerRequestId']).toBe('req_deepseek_assembly');
  });

  it('leaves the assembled streaming message unchanged when withResponse is unavailable', async () => {
    const provider = new DeepSeekProvider({ apiKey: 'deepseek-key' });
    const client = getClient(provider);
    client.chat.completions.create.mockResolvedValue(
      asyncIterableFrom([createChunk('Hello'), createChunk(' there', 'stop')]),
    );

    const result = await provider.chat([createUserMessage('Hello')], {
      model: 'deepseek-v4-flash',
      onTextDelta: () => {},
    });

    expect(result.metadata?.['providerRequestId']).toBeUndefined();
    expect(result.content).toBe('Hello there');
  });

  it('wraps upstream chat failures with DeepSeek context', async () => {
    const provider = new DeepSeekProvider({ apiKey: 'deepseek-key' });
    const client = getClient(provider);
    client.chat.completions.create.mockRejectedValue(new Error('Invalid API key'));

    await expect(
      provider.chat([createUserMessage('Hello')], { model: 'deepseek-v4-flash' }),
    ).rejects.toThrow('DeepSeek chat failed: Invalid API key');
  });
});
