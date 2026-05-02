import { describe, expect, it, vi, beforeEach } from 'vitest';
import type OpenAI from 'openai';
import type { IToolSchema, TUniversalMessage } from '@robota-sdk/agent-core';
import {
  DEFAULT_QWEN_PROVIDER_BASE_URL,
  DEFAULT_QWEN_PROVIDER_RESPONSES_BASE_URL,
  QwenProvider,
} from './index';

vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
    responses: {
      create: vi.fn(),
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
  responses: {
    create: ReturnType<typeof vi.fn>;
  };
}

function getClient(provider: QwenProvider): IOpenAIClientMock {
  return (provider as unknown as { client: IOpenAIClientMock }).client;
}

function getResponsesClient(provider: QwenProvider): IOpenAIClientMock {
  return (provider as unknown as { responsesClient: IOpenAIClientMock }).responsesClient;
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

  it('creates a Responses API client when provider-side web tools are configured', async () => {
    const OpenAIModule = await import('openai');
    const OpenAIConstructor = vi.mocked(OpenAIModule.default);

    new QwenProvider({
      apiKey: 'dashscope-key',
      builtInWebTools: { webSearch: true },
    });

    expect(OpenAIConstructor).toHaveBeenCalledWith({
      apiKey: 'dashscope-key',
      baseURL: DEFAULT_QWEN_PROVIDER_RESPONSES_BASE_URL,
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

  it('uses Qwen Responses API with web_search when built-in web search is enabled', async () => {
    const provider = new QwenProvider({
      apiKey: 'dashscope-key',
      builtInWebTools: { webSearch: true, enableThinking: true },
    });
    const client = getResponsesClient(provider);
    client.responses.create.mockResolvedValue({
      id: 'resp_1',
      model: 'qwen3.6-plus',
      output_text: 'Search-backed answer',
      status: 'completed',
      output: [
        { type: 'web_search_call', id: 'ws_1', status: 'completed' },
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'Search-backed answer' }],
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 4,
        total_tokens: 14,
        x_tools: { web_search: { count: 1 } },
      },
    });

    const result = await provider.chat([createUserMessage('Latest Qwen news')], {
      model: 'qwen3.6-plus',
    });

    expect(client.responses.create).toHaveBeenCalledWith(
      {
        model: 'qwen3.6-plus',
        input: [{ role: 'user', content: 'Latest Qwen news' }],
        tools: [{ type: 'web_search' }],
        enable_thinking: true,
      },
      undefined,
    );
    expect(result.content).toBe('Search-backed answer');
    expect(result.metadata?.['providerToolMode']).toBe('qwen_responses');
    expect(result.metadata?.['providerBuiltInToolsEnabled']).toEqual(['web_search']);
    expect(result.metadata?.['providerBuiltInToolsUsed']).toEqual(['web_search']);
    expect(result.metadata?.['qwenWebSearchCalls']).toBe(1);
  });

  it('adds web_search and web_extractor when built-in web fetch is enabled', async () => {
    const provider = new QwenProvider({
      apiKey: 'dashscope-key',
      builtInWebTools: { webFetch: true },
    });
    const client = getResponsesClient(provider);
    client.responses.create.mockResolvedValue({
      output_text: 'Fetched answer',
      output: [
        {
          type: 'web_extractor_call',
          id: 'wx_1',
          status: 'completed',
          goal: 'fetch a page',
          output: 'page text',
        },
      ],
      usage: {
        input_tokens: 5,
        output_tokens: 3,
        total_tokens: 8,
        x_tools: { web_search: { count: 1 }, web_extractor: { count: 1 } },
      },
    });

    const result = await provider.chat([createUserMessage('Fetch https://example.com')], {
      model: 'qwen3.6-plus',
    });

    expect(client.responses.create).toHaveBeenCalledWith(
      {
        model: 'qwen3.6-plus',
        input: [{ role: 'user', content: 'Fetch https://example.com' }],
        tools: [{ type: 'web_search' }, { type: 'web_extractor' }],
      },
      undefined,
    );
    expect(result.metadata?.['providerBuiltInToolsEnabled']).toEqual([
      'web_search',
      'web_extractor',
    ]);
    expect(result.metadata?.['qwenWebExtractorCalls']).toBe(1);
  });

  it('streams Qwen Responses API text deltas and records provider-side tool provenance', async () => {
    const provider = new QwenProvider({
      apiKey: 'dashscope-key',
      builtInWebTools: { webFetch: true },
    });
    const client = getResponsesClient(provider);
    client.responses.create.mockResolvedValue(
      asyncIterableFrom([
        { type: 'response.output_text.delta', delta: 'Hello ' },
        {
          type: 'response.output_item.done',
          item: {
            type: 'web_extractor_call',
            id: 'wx_1',
            status: 'completed',
            goal: 'extract page',
            output: 'content',
          },
        },
        { type: 'response.output_text.delta', delta: 'world' },
        {
          type: 'response.completed',
          response: {
            id: 'resp_1',
            model: 'qwen3.6-plus',
            status: 'completed',
            output_text: 'Hello world',
            output: [],
            usage: {
              input_tokens: 12,
              output_tokens: 2,
              total_tokens: 14,
              x_tools: { web_search: { count: 1 }, web_extractor: { count: 1 } },
            },
          },
        },
      ]),
    );
    const onTextDelta = vi.fn();

    const result = await provider.chat([createUserMessage('Fetch example')], {
      model: 'qwen3.6-plus',
      onTextDelta,
    });

    expect(client.responses.create).toHaveBeenCalledWith(
      {
        model: 'qwen3.6-plus',
        input: [{ role: 'user', content: 'Fetch example' }],
        tools: [{ type: 'web_search' }, { type: 'web_extractor' }],
        stream: true,
      },
      undefined,
    );
    expect(onTextDelta).toHaveBeenNthCalledWith(1, 'Hello ');
    expect(onTextDelta).toHaveBeenNthCalledWith(2, 'world');
    expect(result.content).toBe('Hello world');
    expect(result.metadata?.['providerBuiltInToolsUsed']).toEqual(['web_search', 'web_extractor']);
  });

  it('keeps local function tools distinct from provider-side built-in tools', async () => {
    const provider = new QwenProvider({
      apiKey: 'dashscope-key',
      builtInWebTools: { webSearch: true },
    });
    const client = getResponsesClient(provider);
    client.responses.create.mockResolvedValue({
      output_text: '',
      output: [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'inspect_file',
          arguments: '{"path":"README.md"}',
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 4,
        total_tokens: 14,
      },
    });

    const result = await provider.chat([createUserMessage('Inspect README')], {
      model: 'qwen3.6-plus',
      tools: [createToolSchema()],
    });

    expect(client.responses.create).toHaveBeenCalledWith(
      {
        model: 'qwen3.6-plus',
        input: [{ role: 'user', content: 'Inspect README' }],
        tools: [
          { type: 'web_search' },
          {
            type: 'function',
            name: 'inspect_file',
            description: 'Inspect a file',
            parameters: createToolSchema().parameters,
          },
        ],
      },
      undefined,
    );
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
    expect(result.metadata?.['providerBuiltInToolsUsed']).toBeUndefined();
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
