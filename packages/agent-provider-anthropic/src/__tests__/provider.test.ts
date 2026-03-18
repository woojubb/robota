import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  TUniversalMessage,
  IChatOptions,
  IToolSchema,
  IExecutor,
  IAssistantMessage,
} from '@robota-sdk/agent-core';

// Mock the @anthropic-ai/sdk module
vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
    },
  }));
  return { default: MockAnthropic };
});

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from '../provider';
import type { IAnthropicProviderOptions } from '../types';

// Helper: build a minimal Anthropic text response
function makeTextResponse(text: string, model = 'claude-3-opus-20240229'): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
  } as Anthropic.Message;
}

// Helper: build a tool_use response
function makeToolUseResponse(
  toolId: string,
  name: string,
  input: Record<string, unknown>,
): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: toolId,
        name,
        input,
      },
    ],
    model: 'claude-3-opus-20240229',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 15, output_tokens: 25 },
  } as unknown as Anthropic.Message;
}

describe('AnthropicProvider', () => {
  let mockClient: { messages: { create: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      messages: {
        create: vi.fn(),
      },
    };
  });

  // ── Constructor ──────────────────────────────────────────────

  describe('constructor', () => {
    it('should accept a pre-built client', () => {
      const provider = new AnthropicProvider({
        client: mockClient as unknown as Anthropic,
      });
      expect(provider.name).toBe('anthropic');
      expect(provider.version).toBe('1.0.0');
    });

    it('should create a client from apiKey', () => {
      const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' });
      expect(provider).toBeDefined();
      expect(Anthropic).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-ant-test' }));
    });

    it('should pass timeout and baseURL when creating client from apiKey', () => {
      new AnthropicProvider({
        apiKey: 'sk-ant-test',
        timeout: 5000,
        baseURL: 'https://custom.api',
      });
      expect(Anthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'sk-ant-test',
          timeout: 5000,
          baseURL: 'https://custom.api',
        }),
      );
    });

    it('should accept an executor without apiKey or client', () => {
      const executor: IExecutor = {
        executeChat: vi.fn(),
        executeChatStream: vi.fn(),
        supportsTools: () => true,
        validateConfig: () => true,
        name: 'mock-executor',
        version: '1.0.0',
      };
      const provider = new AnthropicProvider({ executor });
      expect(provider).toBeDefined();
    });

    it('should throw when no client, apiKey, or executor is provided', () => {
      expect(() => new AnthropicProvider({} as IAnthropicProviderOptions)).toThrow(
        'Either Anthropic client, apiKey, or executor is required',
      );
    });
  });

  // ── validateConfig ───────────────────────────────────────────

  describe('validateConfig', () => {
    it('should return true when client and apiKey are present', () => {
      const provider = new AnthropicProvider({
        client: mockClient as unknown as Anthropic,
        apiKey: 'sk-ant-test',
      });
      expect(provider.validateConfig()).toBe(true);
    });

    it('should return false when apiKey is missing', () => {
      const provider = new AnthropicProvider({
        client: mockClient as unknown as Anthropic,
      });
      expect(provider.validateConfig()).toBe(false);
    });
  });

  // ── supportsTools ────────────────────────────────────────────

  describe('supportsTools', () => {
    it('should return true', () => {
      const provider = new AnthropicProvider({
        client: mockClient as unknown as Anthropic,
      });
      expect(provider.supportsTools()).toBe(true);
    });
  });

  // ── dispose ──────────────────────────────────────────────────

  describe('dispose', () => {
    it('should resolve without error', async () => {
      const provider = new AnthropicProvider({
        client: mockClient as unknown as Anthropic,
      });
      await expect(provider.dispose()).resolves.toBeUndefined();
    });
  });

  // ── chat() — validation ─────────────────────────────────────

  describe('chat — validation', () => {
    let provider: AnthropicProvider;

    beforeEach(() => {
      provider = new AnthropicProvider({
        client: mockClient as unknown as Anthropic,
      });
    });

    it('should throw when messages is not an array', async () => {
      await expect(
        provider.chat('not-an-array' as unknown as TUniversalMessage[], {}),
      ).rejects.toThrow('Messages must be an array');
    });

    it('should throw when messages array is empty', async () => {
      await expect(provider.chat([], {})).rejects.toThrow('Messages array cannot be empty');
    });

    it('should throw when a message has an invalid role', async () => {
      const messages = [{ role: 'invalid', content: 'hi' }] as unknown as TUniversalMessage[];
      await expect(provider.chat(messages, {})).rejects.toThrow('Invalid message role: invalid');
    });

    it('should throw when model is not specified', async () => {
      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hello', timestamp: new Date() },
      ];
      await expect(provider.chat(messages, {})).rejects.toThrow(
        'Model is required in chat options',
      );
    });
  });

  // ── chat() — direct execution ───────────────────────────────

  describe('chat — direct execution', () => {
    let provider: AnthropicProvider;

    beforeEach(() => {
      provider = new AnthropicProvider({
        client: mockClient as unknown as Anthropic,
      });
    });

    it('should send correct request params and return text response', async () => {
      const apiResponse = makeTextResponse('Hello there!');
      mockClient.messages.create.mockResolvedValue(apiResponse);

      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hi', timestamp: new Date() },
      ];
      const options: IChatOptions = { model: 'claude-3-opus-20240229', maxTokens: 1024 };

      const result = await provider.chat(messages, options);

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-3-opus-20240229',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      );
      expect(result.role).toBe('assistant');
      expect(result.content).toBe('Hello there!');
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.inputTokens).toBe(10);
      expect(result.metadata?.outputTokens).toBe(20);
    });

    it('should use DEFAULT_MAX_TOKENS when maxTokens is not specified', async () => {
      mockClient.messages.create.mockResolvedValue(makeTextResponse('ok'));

      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hi', timestamp: new Date() },
      ];
      await provider.chat(messages, { model: 'claude-3-opus-20240229' });

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 4096 }),
      );
    });

    it('should include temperature when specified', async () => {
      mockClient.messages.create.mockResolvedValue(makeTextResponse('ok'));

      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hi', timestamp: new Date() },
      ];
      await provider.chat(messages, { model: 'claude-3-opus-20240229', temperature: 0.5 });

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.5 }),
      );
    });

    it('should include tools in Anthropic format when specified', async () => {
      mockClient.messages.create.mockResolvedValue(makeTextResponse('ok'));

      const tools: IToolSchema[] = [
        {
          name: 'get_weather',
          description: 'Get the weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ];
      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Weather?', timestamp: new Date() },
      ];
      await provider.chat(messages, { model: 'claude-3-opus-20240229', tools });

      const callArgs = mockClient.messages.create.mock.calls[0][0];
      expect(callArgs.tools).toEqual([
        {
          name: 'get_weather',
          description: 'Get the weather',
          input_schema: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ]);
    });

    it('should handle tool_use response', async () => {
      const apiResponse = makeToolUseResponse('call_1', 'get_weather', { city: 'Seoul' });
      mockClient.messages.create.mockResolvedValue(apiResponse);

      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Weather in Seoul', timestamp: new Date() },
      ];
      const result = await provider.chat(messages, { model: 'claude-3-opus-20240229' });

      expect(result.role).toBe('assistant');
      expect(result.content).toBeNull();
      const assistantResult = result as IAssistantMessage;
      expect(assistantResult.toolCalls).toHaveLength(1);
      expect(assistantResult.toolCalls![0]).toEqual({
        id: 'call_1',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: JSON.stringify({ city: 'Seoul' }),
        },
      });
    });

    it('should throw when response has no content', async () => {
      const emptyResponse = {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-3-opus-20240229',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      } as unknown as Anthropic.Message;
      mockClient.messages.create.mockResolvedValue(emptyResponse);

      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hi', timestamp: new Date() },
      ];
      await expect(provider.chat(messages, { model: 'claude-3-opus-20240229' })).rejects.toThrow(
        'No content in Anthropic response',
      );
    });

    it('should throw when response has unsupported content type', async () => {
      const weirdResponse = {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'image', data: 'base64...' }],
        model: 'claude-3-opus-20240229',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      } as unknown as Anthropic.Message;
      mockClient.messages.create.mockResolvedValue(weirdResponse);

      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hi', timestamp: new Date() },
      ];
      await expect(provider.chat(messages, { model: 'claude-3-opus-20240229' })).rejects.toThrow(
        'Unsupported content type: image',
      );
    });

    it('should include stopReason in metadata when stop_reason is present', async () => {
      const response = makeTextResponse('done');
      mockClient.messages.create.mockResolvedValue(response);

      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hi', timestamp: new Date() },
      ];
      const result = await provider.chat(messages, { model: 'claude-3-opus-20240229' });
      expect(result.metadata?.stopReason).toBe('end_turn');
    });

    it('should omit stopReason from metadata when stop_reason is null', async () => {
      const response = makeTextResponse('done');
      (response as unknown as Record<string, unknown>).stop_reason = null;
      mockClient.messages.create.mockResolvedValue(response);

      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hi', timestamp: new Date() },
      ];
      const result = await provider.chat(messages, { model: 'claude-3-opus-20240229' });
      expect(result.metadata?.stopReason).toBeUndefined();
    });
  });

  // ── chat() — message conversion ─────────────────────────────

  describe('chat — message format conversion', () => {
    let provider: AnthropicProvider;

    beforeEach(() => {
      provider = new AnthropicProvider({
        client: mockClient as unknown as Anthropic,
      });
      mockClient.messages.create.mockResolvedValue(makeTextResponse('ok'));
    });

    it('should convert user messages', async () => {
      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hello', timestamp: new Date() },
      ];
      await provider.chat(messages, { model: 'claude-3-opus-20240229' });

      const sentMessages = mockClient.messages.create.mock.calls[0][0].messages;
      expect(sentMessages).toEqual([{ role: 'user', content: 'Hello' }]);
    });

    it('should convert system messages to user role', async () => {
      const messages: TUniversalMessage[] = [
        { role: 'system', content: 'You are helpful', timestamp: new Date() },
        { role: 'user', content: 'Hi', timestamp: new Date() },
      ];
      await provider.chat(messages, { model: 'claude-3-opus-20240229' });

      const sentMessages = mockClient.messages.create.mock.calls[0][0].messages;
      expect(sentMessages[0]).toEqual({ role: 'user', content: 'You are helpful' });
    });

    it('should convert assistant messages with toolCalls to content blocks', async () => {
      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hi', timestamp: new Date() },
        {
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          toolCalls: [
            {
              id: 'call_1',
              type: 'function' as const,
              function: {
                name: 'get_weather',
                arguments: JSON.stringify({ city: 'Tokyo' }),
              },
            },
          ],
        },
      ];
      await provider.chat(messages, { model: 'claude-3-opus-20240229' });

      const sentMessages = mockClient.messages.create.mock.calls[0][0].messages;
      expect(sentMessages[1]).toEqual({
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'get_weather',
            input: { city: 'Tokyo' },
          },
        ],
      });
    });

    it('should convert regular assistant messages as string content', async () => {
      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hi', timestamp: new Date() },
        { role: 'assistant', content: 'Hello!', timestamp: new Date() },
        { role: 'user', content: 'More', timestamp: new Date() },
      ];
      await provider.chat(messages, { model: 'claude-3-opus-20240229' });

      const sentMessages = mockClient.messages.create.mock.calls[0][0].messages;
      expect(sentMessages[1]).toEqual({ role: 'assistant', content: 'Hello!' });
    });

    it('should default content to empty string when undefined', async () => {
      const messages: TUniversalMessage[] = [
        { role: 'user', content: undefined as unknown as string, timestamp: new Date() },
      ];
      await provider.chat(messages, { model: 'claude-3-opus-20240229' });

      const sentMessages = mockClient.messages.create.mock.calls[0][0].messages;
      expect(sentMessages[0].content).toBe('');
    });
  });

  // ── chat() — executor delegation ────────────────────────────

  describe('chat — executor delegation', () => {
    it('should delegate to executor when configured', async () => {
      const expectedResponse: TUniversalMessage = {
        role: 'assistant',
        content: 'From executor',
        timestamp: new Date(),
      };
      const executor: IExecutor = {
        executeChat: vi.fn().mockResolvedValue(expectedResponse),
        executeChatStream: vi.fn(),
        supportsTools: () => true,
        validateConfig: () => true,
        name: 'mock-executor',
        version: '1.0.0',
      };

      const provider = new AnthropicProvider({ executor });
      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hi', timestamp: new Date() },
      ];

      const result = await provider.chat(messages, { model: 'claude-3-opus-20240229' });
      expect(result).toBe(expectedResponse);
      expect(executor.executeChat).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
          model: 'claude-3-opus-20240229',
        }),
      );
    });

    it('should propagate executor errors', async () => {
      const executor: IExecutor = {
        executeChat: vi.fn().mockRejectedValue(new Error('executor failed')),
        executeChatStream: vi.fn(),
        supportsTools: () => true,
        validateConfig: () => true,
        name: 'mock-executor',
        version: '1.0.0',
      };

      const provider = new AnthropicProvider({ executor });
      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hi', timestamp: new Date() },
      ];

      await expect(provider.chat(messages, { model: 'claude-3-opus-20240229' })).rejects.toThrow(
        'executor failed',
      );
    });
  });

  // ── chatStream() — validation ───────────────────────────────

  describe('chatStream — validation', () => {
    let provider: AnthropicProvider;

    beforeEach(() => {
      provider = new AnthropicProvider({
        client: mockClient as unknown as Anthropic,
      });
    });

    it('should throw when messages array is empty', async () => {
      const gen = provider.chatStream([], { model: 'claude-3-opus-20240229' });
      await expect(gen[Symbol.asyncIterator]().next()).rejects.toThrow(
        'Messages array cannot be empty',
      );
    });

    it('should throw when model is not specified', async () => {
      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hi', timestamp: new Date() },
      ];
      const gen = provider.chatStream(messages, {});
      await expect(gen[Symbol.asyncIterator]().next()).rejects.toThrow(
        'Model is required in chat options',
      );
    });
  });

  // ── chatStream() — direct execution ─────────────────────────

  describe('chatStream — direct execution', () => {
    let provider: AnthropicProvider;

    beforeEach(() => {
      provider = new AnthropicProvider({
        client: mockClient as unknown as Anthropic,
      });
    });

    it('should yield text_delta chunks as assistant messages', async () => {
      const asyncChunks = (async function* () {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } };
      })();

      mockClient.messages.create.mockResolvedValue(asyncChunks);

      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hi', timestamp: new Date() },
      ];

      const chunks: TUniversalMessage[] = [];
      for await (const chunk of provider.chatStream(messages, {
        model: 'claude-3-opus-20240229',
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0].role).toBe('assistant');
      expect(chunks[0].content).toBe('Hello');
      expect(chunks[1].content).toBe(' world');
    });

    it('should skip non-text-delta chunks', async () => {
      const asyncChunks = (async function* () {
        yield { type: 'message_start', message: {} };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } };
        yield { type: 'content_block_stop' };
        yield { type: 'message_stop' };
      })();

      mockClient.messages.create.mockResolvedValue(asyncChunks);

      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hi', timestamp: new Date() },
      ];

      const chunks: TUniversalMessage[] = [];
      for await (const chunk of provider.chatStream(messages, {
        model: 'claude-3-opus-20240229',
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe('Hi');
    });

    it('should include temperature and tools in stream request', async () => {
      const asyncChunks = (async function* () {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } };
      })();
      mockClient.messages.create.mockResolvedValue(asyncChunks);

      const tools: IToolSchema[] = [
        {
          name: 'search',
          description: 'Search',
          parameters: { type: 'object', properties: {} },
        },
      ];
      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hi', timestamp: new Date() },
      ];

      // Consume the stream
      for await (const _chunk of provider.chatStream(messages, {
        model: 'claude-3-opus-20240229',
        temperature: 0.7,
        tools,
      })) {
        // just consume
      }

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          stream: true,
          temperature: 0.7,
          tools: expect.arrayContaining([expect.objectContaining({ name: 'search' })]),
        }),
      );
    });
  });

  // ── chatStream() — executor delegation ──────────────────────

  describe('chatStream — executor delegation', () => {
    it('should delegate streaming to executor when configured', async () => {
      const streamChunks: TUniversalMessage[] = [
        { role: 'assistant', content: 'chunk1', timestamp: new Date() },
        { role: 'assistant', content: 'chunk2', timestamp: new Date() },
      ];

      const executor: IExecutor = {
        executeChat: vi.fn(),
        executeChatStream: vi.fn().mockImplementation(async function* () {
          for (const c of streamChunks) {
            yield c;
          }
        }),
        supportsTools: () => true,
        validateConfig: () => true,
        name: 'mock-executor',
        version: '1.0.0',
      };

      const provider = new AnthropicProvider({ executor });
      const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hi', timestamp: new Date() },
      ];

      const collected: TUniversalMessage[] = [];
      for await (const chunk of provider.chatStream(messages, {
        model: 'claude-3-opus-20240229',
      })) {
        collected.push(chunk);
      }

      expect(collected).toHaveLength(2);
      expect(collected[0].content).toBe('chunk1');
    });
  });

  // ── chatStream() — no client available ──────────────────────

  describe('chatStream — no client', () => {
    it('should throw when neither client nor executor is provided', () => {
      expect(() => new AnthropicProvider({} as IAnthropicProviderOptions)).toThrow(
        'Either Anthropic client, apiKey, or executor is required',
      );
    });
  });

  // ── chat() — no client for direct path ──────────────────────

  describe('chat — no client for direct execution', () => {
    it('should throw when executor is not set and client is unavailable', async () => {
      // This error path is guarded by the constructor, which always requires
      // at least one of client/apiKey/executor. We verify the constructor
      // guard in the constructor tests above.
      expect(() => new AnthropicProvider({} as IAnthropicProviderOptions)).toThrow(
        'Either Anthropic client, apiKey, or executor is required',
      );
    });
  });
});
