import { describe, expect, it, vi, beforeEach } from 'vitest';
import type OpenAI from 'openai';
import { GemmaProvider } from './index';
import type {
  IProviderNativeRawPayloadEvent,
  IToolSchema,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

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

function createUserMessage(content: string): TUniversalMessage {
  return {
    id: 'user-1',
    role: 'user',
    content,
    state: 'complete',
    timestamp,
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
    model: 'supergemma4',
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

function createToolCallChunk(toolName: string, args: string): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: 'chunk-tool',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'supergemma4',
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call-1',
              type: 'function',
              function: { name: toolName, arguments: args },
            },
          ],
        },
        finish_reason: 'tool_calls',
        logprobs: null,
      },
    ],
  };
}

function createDeclaredToolSchema(): IToolSchema {
  return {
    name: 'DeclaredTool',
    description: 'Declared test tool',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        mode: { type: 'string' },
        background: { type: 'boolean' },
      },
      required: ['prompt'],
    },
  };
}

describe('GemmaProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an OpenAI-compatible client with local endpoint options', async () => {
    const OpenAIModule = await import('openai');
    const OpenAIConstructor = vi.mocked(OpenAIModule.default);

    const provider = new GemmaProvider({
      apiKey: 'lm-studio',
      baseURL: 'http://localhost:1234/v1',
      timeout: 1000,
    });

    expect(provider.name).toBe('gemma');
    expect(OpenAIConstructor).toHaveBeenCalledWith({
      apiKey: 'lm-studio',
      baseURL: 'http://localhost:1234/v1',
      timeout: 1000,
    });
  });

  it('reports provider-native web tools as unsupported for LM Studio/Gemma chat completions', () => {
    const provider = new GemmaProvider({
      apiKey: 'lm-studio',
      baseURL: 'http://localhost:1234/v1',
    });

    expect(provider.getCapabilities().nativeWebTools).toEqual({
      webSearch: {
        supported: false,
        enabled: false,
        source: 'openai-compatible-chat-completions',
        reason:
          'Gemma OpenAI-compatible endpoints support declared function tools, not provider-native web search.',
      },
      webFetch: {
        supported: false,
        enabled: false,
        source: 'openai-compatible-chat-completions',
        reason:
          'Gemma OpenAI-compatible endpoints support declared function tools, not provider-native web fetch.',
      },
    });
  });

  it('rejects request-level native web tools before LM Studio transport execution', async () => {
    const provider = new GemmaProvider({
      apiKey: 'lm-studio',
      baseURL: 'http://localhost:1234/v1',
    });

    await expect(
      provider.chat([createUserMessage('Search the web')], {
        model: 'supergemma4',
        nativeWebTools: { webSearch: true },
      }),
    ).rejects.toThrow(
      'Provider gemma does not support native web search. Gemma OpenAI-compatible endpoints support declared function tools, not provider-native web search.',
    );
  });

  it('filters Gemma reasoning markers from non-streaming chat content', async () => {
    const provider = new GemmaProvider({ apiKey: 'lm-studio' });
    const client = (
      provider as unknown as {
        client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
      }
    ).client;
    client.chat.completions.create.mockResolvedValue({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1,
      model: 'supergemma4',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '<|channel>thought\nhidden<channel|>Visible answer',
            refusal: null,
          },
          finish_reason: 'stop',
          logprobs: null,
        },
      ],
    });

    const result = await provider.chat([createUserMessage('Hello')], { model: 'supergemma4' });

    expect(result.content).toBe('Visible answer');
    expect(result.metadata?.['gemmaReasoningFiltered']).toBe(true);
    expect(result.metadata?.['gemmaRawContent']).toBe(
      '<|channel>thought\nhidden<channel|>Visible answer',
    );
  });

  it('emits native Chat Completions request and response payloads before Gemma projection', async () => {
    const provider = new GemmaProvider({ apiKey: 'lm-studio' });
    const client = (
      provider as unknown as {
        client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
      }
    ).client;
    client.chat.completions.create.mockResolvedValue({
      id: 'gemma-native',
      object: 'chat.completion',
      created: 1,
      model: 'supergemma4',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Visible answer', refusal: null },
          finish_reason: 'stop',
          logprobs: null,
        },
      ],
    });
    const events: IProviderNativeRawPayloadEvent[] = [];

    await provider.chat([createUserMessage('Hello')], {
      model: 'supergemma4',
      onProviderNativeRawPayload: (event) => events.push(event),
    });

    expect(events).toEqual([
      expect.objectContaining({
        provider: 'gemma',
        apiSurface: 'chat-completions',
        payloadKind: 'request',
      }),
      expect.objectContaining({
        provider: 'gemma',
        apiSurface: 'chat-completions',
        payloadKind: 'response',
        payload: expect.objectContaining({ id: 'gemma-native' }),
      }),
    ]);
  });

  it('filters Gemma reasoning markers from streaming chat assembly and deltas', async () => {
    const provider = new GemmaProvider({ apiKey: 'lm-studio' });
    const client = (
      provider as unknown as {
        client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
      }
    ).client;
    client.chat.completions.create.mockResolvedValue(
      asyncIterableFrom([
        createChunk('<|cha'),
        createChunk('nnel>thought\nhidden'),
        createChunk('<channel|>Visible'),
        createChunk(' answer', 'stop'),
      ]),
    );
    const onTextDelta = vi.fn();

    const result = await provider.chat([createUserMessage('Hello')], {
      model: 'supergemma4',
      onTextDelta,
    });

    expect(result.content).toBe('Visible answer');
    expect(onTextDelta).toHaveBeenCalledTimes(2);
    expect(onTextDelta).toHaveBeenNthCalledWith(1, 'Visible');
    expect(onTextDelta).toHaveBeenNthCalledWith(2, ' answer');
    expect(result.metadata?.['gemmaReasoningFiltered']).toBe(true);
  });

  it('emits ordered native Chat Completions stream chunks before Gemma projection', async () => {
    const provider = new GemmaProvider({ apiKey: 'lm-studio' });
    const client = (
      provider as unknown as {
        client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
      }
    ).client;
    client.chat.completions.create.mockResolvedValue(
      asyncIterableFrom([createChunk('Visible'), createChunk(' answer', 'stop')]),
    );
    const events: IProviderNativeRawPayloadEvent[] = [];

    await provider.chat([createUserMessage('Hello')], {
      model: 'supergemma4',
      onTextDelta: vi.fn(),
      onProviderNativeRawPayload: (event) => events.push(event),
    });

    expect(events.map((event) => event.payloadKind)).toEqual([
      'request',
      'stream_event',
      'stream_event',
    ]);
    expect(
      events.filter((event) => event.payloadKind === 'stream_event').map((event) => event.sequence),
    ).toEqual([0, 1]);
  });

  it('projects Gemma native tool-call text from non-streaming chat content', async () => {
    const provider = new GemmaProvider({ apiKey: 'lm-studio' });
    const client = (
      provider as unknown as {
        client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
      }
    ).client;
    client.chat.completions.create.mockResolvedValue({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1,
      model: 'supergemma4',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content:
              '<|tool_call>call:DeclaredTool{prompt:<|"|>analyze<|"|>,background:true}<tool_call|>',
            refusal: null,
          },
          finish_reason: 'tool_calls',
          logprobs: null,
        },
      ],
    });

    const result = await provider.chat([createUserMessage('Hello')], {
      model: 'supergemma4',
      tools: [createDeclaredToolSchema()],
    });

    expect(result.content).toBe('');
    expect(result.metadata?.['toolCallTextProjected']).toBe(true);
    if (result.role !== 'assistant') throw new Error('Expected assistant message');
    expect(result.toolCalls).toEqual([
      {
        id: 'gemma_call_0',
        type: 'function',
        function: {
          name: 'DeclaredTool',
          arguments: '{"prompt":"analyze","background":true}',
        },
      },
    ]);
  });

  it('passes undeclared native OpenAI-compatible tool calls to core for normal tool-result errors', async () => {
    const provider = new GemmaProvider({ apiKey: 'lm-studio' });
    const client = (
      provider as unknown as {
        client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
      }
    ).client;
    client.chat.completions.create.mockResolvedValue({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1,
      model: 'supergemma4',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: { name: 'agent', arguments: '{"prompt":"do work"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
          logprobs: null,
        },
      ],
    });

    const result = await provider.chat([createUserMessage('Hello')], {
      model: 'supergemma4',
      tools: [createDeclaredToolSchema()],
    });

    if (result.role !== 'assistant') throw new Error('Expected assistant message');
    expect(result.toolCalls).toEqual([
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'agent', arguments: '{"prompt":"do work"}' },
      },
    ]);
  });

  it('projects split Gemma native tool-call text from streaming chat assembly', async () => {
    const provider = new GemmaProvider({ apiKey: 'lm-studio' });
    const client = (
      provider as unknown as {
        client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
      }
    ).client;
    client.chat.completions.create.mockResolvedValue(
      asyncIterableFrom([
        createChunk('<|tool_call>call:Declar'),
        createChunk('edTool{prompt:<|"|>analyze<|"|>,background:true}<tool_call|>'),
        createChunk('', 'tool_calls'),
      ]),
    );
    const onTextDelta = vi.fn();

    const result = await provider.chat([createUserMessage('Hello')], {
      model: 'supergemma4',
      tools: [createDeclaredToolSchema()],
      onTextDelta,
    });

    expect(onTextDelta).not.toHaveBeenCalled();
    expect(result.content).toBe('');
    expect(result.metadata?.['toolCallTextProjected']).toBe(true);
    if (result.role !== 'assistant') throw new Error('Expected assistant message');
    expect(result.toolCalls).toEqual([
      {
        id: 'gemma_call_0',
        type: 'function',
        function: {
          name: 'DeclaredTool',
          arguments: '{"prompt":"analyze","background":true}',
        },
      },
    ]);
  });

  it('passes undeclared native OpenAI-compatible tool calls during streaming assembly', async () => {
    const provider = new GemmaProvider({ apiKey: 'lm-studio' });
    const client = (
      provider as unknown as {
        client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
      }
    ).client;
    client.chat.completions.create.mockResolvedValue(
      asyncIterableFrom([createToolCallChunk('agent', '{"prompt":"do work"}')]),
    );

    const result = await provider.chat([createUserMessage('Hello')], {
      model: 'supergemma4',
      tools: [createDeclaredToolSchema()],
      onTextDelta: vi.fn(),
    });

    if (result.role !== 'assistant') throw new Error('Expected assistant message');
    expect(result.toolCalls).toEqual([
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'agent', arguments: '{"prompt":"do work"}' },
      },
    ]);
  });

  it('projects split Gemma native tool-call text from direct chatStream chunks', async () => {
    const provider = new GemmaProvider({ apiKey: 'lm-studio' });
    const client = (
      provider as unknown as {
        client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
      }
    ).client;
    client.chat.completions.create.mockResolvedValue(
      asyncIterableFrom([
        createChunk('<|tool_call>call:Declar'),
        createChunk('edTool{prompt:<|"|>analyze<|"|>}<tool_call|>'),
        createChunk('', 'tool_calls'),
      ]),
    );

    const chunks: TUniversalMessage[] = [];
    for await (const chunk of provider.chatStream?.([createUserMessage('Hello')], {
      model: 'supergemma4',
      tools: [createDeclaredToolSchema()],
    }) ?? []) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    const [toolCallChunk] = chunks;
    expect(toolCallChunk?.content).toBe('');
    if (!toolCallChunk || toolCallChunk.role !== 'assistant') {
      throw new Error('Expected assistant message');
    }
    expect(toolCallChunk.toolCalls).toEqual([
      {
        id: 'gemma_call_0',
        type: 'function',
        function: {
          name: 'DeclaredTool',
          arguments: '{"prompt":"analyze"}',
        },
      },
    ]);
  });

  it('encapsulates XML-like declared tool tags as tool calls in non-streaming chat', async () => {
    const provider = new GemmaProvider({ apiKey: 'lm-studio' });
    const client = (
      provider as unknown as {
        client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
      }
    ).client;
    client.chat.completions.create.mockResolvedValue({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1,
      model: 'supergemma4',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content:
              '<tool-launch-sequence>prepare tools</tool-launch-sequence><DeclaredTool prompt="analyze backlog" mode="plan" />',
            refusal: null,
          },
          finish_reason: 'tool_calls',
          logprobs: null,
        },
      ],
    });

    const result = await provider.chat([createUserMessage('Launch tools')], {
      model: 'supergemma4',
      tools: [createDeclaredToolSchema()],
    });

    expect(result.content).toBe('');
    expect(result.metadata?.['toolCallTextProjected']).toBe(true);
    if (result.role !== 'assistant') throw new Error('Expected assistant message');
    expect(result.toolCalls).toEqual([
      {
        id: 'gemma_call_0',
        type: 'function',
        function: {
          name: 'DeclaredTool',
          arguments: '{"prompt":"analyze backlog","mode":"plan"}',
        },
      },
    ]);
  });

  it('does not synthesize tool calls from command-like text inside XML wrappers', async () => {
    const provider = new GemmaProvider({ apiKey: 'lm-studio' });
    const client = (
      provider as unknown as {
        client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
      }
    ).client;
    client.chat.completions.create.mockResolvedValue({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1,
      model: 'supergemma4',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: [
              '<tool-launch>',
              'parallel',
              ' worker=DeclaredTool:"Analyze implementation."',
              ' reviewer=DeclaredTool:"Analyze architecture."',
              '</tool-launch>',
            ].join('\n'),
            refusal: null,
          },
          finish_reason: 'tool_calls',
          logprobs: null,
        },
      ],
    });

    const result = await provider.chat([createUserMessage('Launch tools')], {
      model: 'supergemma4',
      tools: [createDeclaredToolSchema()],
    });

    expect(result.content).toBe('');
    expect(result.metadata?.['toolCallTextProjected']).toBe(true);
    if (result.role !== 'assistant') throw new Error('Expected assistant message');
    expect(result.toolCalls).toBeUndefined();
  });

  it('encapsulates split XML-like declared tool tags during streaming assembly', async () => {
    const provider = new GemmaProvider({ apiKey: 'lm-studio' });
    const client = (
      provider as unknown as {
        client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
      }
    ).client;
    client.chat.completions.create.mockResolvedValue(
      asyncIterableFrom([
        createChunk('<tool-launch-sequence>prepare'),
        createChunk(' tools</tool-launch-sequence><DeclaredTool prompt="analyze backlog"'),
        createChunk(' mode="worker" />'),
        createChunk('', 'tool_calls'),
      ]),
    );
    const onTextDelta = vi.fn();

    const result = await provider.chat([createUserMessage('Launch tools')], {
      model: 'supergemma4',
      tools: [createDeclaredToolSchema()],
      onTextDelta,
    });

    expect(onTextDelta).not.toHaveBeenCalled();
    expect(result.content).toBe('');
    expect(result.metadata?.['toolCallTextProjected']).toBe(true);
    if (result.role !== 'assistant') throw new Error('Expected assistant message');
    expect(result.toolCalls).toEqual([
      {
        id: 'gemma_call_0',
        type: 'function',
        function: {
          name: 'DeclaredTool',
          arguments: '{"prompt":"analyze backlog","mode":"worker"}',
        },
      },
    ]);
  });
});
