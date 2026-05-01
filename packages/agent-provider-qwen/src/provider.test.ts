import { describe, expect, it, vi, beforeEach } from 'vitest';
import type OpenAI from 'openai';
import type { IToolSchema, TUniversalMessage } from '@robota-sdk/agent-core';
import { DEFAULT_QWEN_PROVIDER_BASE_URL, QwenProvider } from './index';

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

function getClient(provider: QwenProvider): IOpenAIClientMock {
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
    model: 'qwen-plus',
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

describe('QwenProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an OpenAI-compatible client with Qwen endpoint options', async () => {
    const OpenAIModule = await import('openai');
    const OpenAIConstructor = vi.mocked(OpenAIModule.default);

    const provider = new QwenProvider({
      apiKey: 'dashscope-key',
      baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      timeout: 1000,
    });

    expect(provider.name).toBe('qwen');
    expect(OpenAIConstructor).toHaveBeenCalledWith({
      apiKey: 'dashscope-key',
      baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      timeout: 1000,
    });
  });

  it('uses the documented Qwen OpenAI-compatible base URL by default', async () => {
    const OpenAIModule = await import('openai');
    const OpenAIConstructor = vi.mocked(OpenAIModule.default);

    new QwenProvider({
      apiKey: 'dashscope-key',
    });

    expect(OpenAIConstructor).toHaveBeenCalledWith({
      apiKey: 'dashscope-key',
      baseURL: DEFAULT_QWEN_PROVIDER_BASE_URL,
    });
  });

  it('sends OpenAI-compatible messages and tools, then parses native tool calls', async () => {
    const provider = new QwenProvider({
      apiKey: 'dashscope-key',
      baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    });
    const client = getClient(provider);
    client.chat.completions.create.mockResolvedValue({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1,
      model: 'qwen-plus',
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
      model: 'qwen-plus',
      tools: [createToolSchema()],
    });

    expect(client.chat.completions.create).toHaveBeenCalledWith({
      model: 'qwen-plus',
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
    });
    expect(result.content).toBe('');
    expect(result.metadata?.['finishReason']).toBe('tool_calls');
    if (result.role !== 'assistant') throw new Error('Expected assistant message');
    expect(result).toMatchObject({
      usage: {
        promptTokens: 10,
        completionTokens: 4,
        totalTokens: 14,
      },
    });
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

  it('uses streaming assembly when text deltas are requested', async () => {
    const provider = new QwenProvider({ apiKey: 'dashscope-key' });
    const client = getClient(provider);
    client.chat.completions.create.mockResolvedValue(
      asyncIterableFrom([createChunk('Hello'), createChunk(' from '), createChunk('Qwen', 'stop')]),
    );
    const onTextDelta = vi.fn();

    const result = await provider.chat([createUserMessage('Hello')], {
      model: 'qwen-plus',
      onTextDelta,
    });

    expect(client.chat.completions.create).toHaveBeenCalledWith(
      {
        model: 'qwen-plus',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      },
      undefined,
    );
    expect(onTextDelta).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onTextDelta).toHaveBeenNthCalledWith(2, ' from ');
    expect(onTextDelta).toHaveBeenNthCalledWith(3, 'Qwen');
    expect(result.content).toBe('Hello from Qwen');
    expect(result.metadata?.['model']).toBe('qwen-plus');
    expect(result.metadata?.['finishReason']).toBe('stop');
  });

  it('yields universal assistant messages from direct chatStream chunks', async () => {
    const provider = new QwenProvider({ apiKey: 'dashscope-key' });
    const client = getClient(provider);
    client.chat.completions.create.mockResolvedValue(
      asyncIterableFrom([createChunk('Part one'), createChunk(' done', 'stop')]),
    );

    const chunks: TUniversalMessage[] = [];
    for await (const chunk of provider.chatStream?.([createUserMessage('Stream')], {
      model: 'qwen-plus',
    }) ?? []) {
      chunks.push(chunk);
    }

    expect(client.chat.completions.create).toHaveBeenCalledWith({
      model: 'qwen-plus',
      messages: [{ role: 'user', content: 'Stream' }],
      stream: true,
    });
    expect(chunks.map((chunk) => chunk.content)).toEqual(['Part one', ' done']);
    expect(chunks[1]?.metadata?.['isComplete']).toBe(true);
  });

  it('wraps upstream chat failures with Qwen context', async () => {
    const provider = new QwenProvider({ apiKey: 'dashscope-key' });
    const client = getClient(provider);
    client.chat.completions.create.mockRejectedValue(new Error('Invalid API key'));

    await expect(
      provider.chat([createUserMessage('Hello')], { model: 'qwen-plus' }),
    ).rejects.toThrow('Qwen chat failed: Invalid API key');
  });
});
