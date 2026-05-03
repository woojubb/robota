import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from './provider';
import type { TUniversalMessage, ILogger } from '@robota-sdk/agent-core';
import type { IPayloadLogger } from './interfaces/payload-logger';

// Mock OpenAI SDK
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

function createMockLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  };
}

function createMockPayloadLogger(enabled = true): IPayloadLogger {
  return {
    isEnabled: vi.fn().mockReturnValue(enabled),
    logPayload: vi.fn().mockResolvedValue(undefined),
  };
}

function createUserMessage(content: string): TUniversalMessage {
  return { id: 'msg-1', state: 'complete' as const, role: 'user', content, timestamp: new Date() };
}

function createSystemMessage(content: string): TUniversalMessage {
  return {
    id: 'msg-1',
    state: 'complete' as const,
    role: 'system',
    content,
    timestamp: new Date(),
  };
}

describe('OpenAIProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should throw when no client, apiKey, or executor is provided', () => {
      expect(() => new OpenAIProvider({})).toThrow(
        'Either OpenAI client, apiKey, or executor is required',
      );
    });

    it('should create provider with apiKey', () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      expect(provider.name).toBe('openai');
      expect(provider.version).toBe('1.0.0');
    });

    it('exposes onTextDelta so Session can wire streaming callbacks', () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      expect('onTextDelta' in provider).toBe(true);
    });

    it('should create provider with client', () => {
      const mockClient = { chat: { completions: { create: vi.fn() } } };
      const provider = new OpenAIProvider({ client: mockClient as never });
      expect(provider.name).toBe('openai');
    });

    it('should create provider with executor (no apiKey needed)', () => {
      const mockExecutor = {
        chat: vi.fn(),
        chatStream: vi.fn(),
      };
      const provider = new OpenAIProvider({ executor: mockExecutor as never });
      expect(provider.name).toBe('openai');
    });

    it('should accept custom logger', () => {
      const logger = createMockLogger();
      const provider = new OpenAIProvider({
        apiKey: 'sk-test',
        apiSurface: 'chat-completions',
        logger,
      });
      expect(provider.name).toBe('openai');
    });

    it('should accept payload logger', () => {
      const payloadLogger = createMockPayloadLogger();
      const provider = new OpenAIProvider({
        apiKey: 'sk-test',
        apiSurface: 'chat-completions',
        payloadLogger,
      });
      expect(provider.name).toBe('openai');
    });
  });

  describe('supportsTools', () => {
    it('should return true', () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      expect(provider.supportsTools()).toBe(true);
    });
  });

  describe('capabilities', () => {
    it('reports OpenAI-compatible Chat Completions native web tools as unsupported', () => {
      const provider = new OpenAIProvider({
        apiKey: 'local-key',
        baseURL: 'http://localhost:1234/v1',
      });

      expect(provider.getCapabilities().nativeWebTools).toEqual({
        webSearch: {
          supported: false,
          enabled: false,
          source: 'openai-compatible-chat-completions',
          reason:
            'OpenAI-compatible Chat Completions endpoints support declared function tools, not provider-native web search.',
        },
        webFetch: {
          supported: false,
          enabled: false,
          source: 'openai-compatible-chat-completions',
          reason:
            'OpenAI-compatible Chat Completions endpoints support declared function tools, not provider-native web fetch.',
        },
      });
    });

    it('rejects per-request native web tools before transport execution', async () => {
      const provider = new OpenAIProvider({
        apiKey: 'local-key',
        baseURL: 'http://localhost:1234/v1',
      });

      await expect(
        provider.chat([createUserMessage('Search the web')], {
          model: 'local-model',
          nativeWebTools: { webSearch: true },
        }),
      ).rejects.toThrow(
        'Provider openai does not support native web search. OpenAI-compatible Chat Completions endpoints support declared function tools, not provider-native web search.',
      );
    });
  });

  describe('validateConfig', () => {
    it('should return true when client is available', () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      expect(provider.validateConfig()).toBe(true);
    });

    it('should return false when using executor (no client)', () => {
      const mockExecutor = { chat: vi.fn(), chatStream: vi.fn() };
      const provider = new OpenAIProvider({ executor: mockExecutor as never });
      // No client when using executor
      expect(provider.validateConfig()).toBe(false);
    });
  });

  describe('dispose', () => {
    it('should complete without error', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      await expect(provider.dispose()).resolves.toBeUndefined();
    });
  });

  describe('Responses API path', () => {
    it('uses Responses API by default for official OpenAI profiles', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test' });
      const messages: TUniversalMessage[] = [createUserMessage('Hello')];
      const client = (
        provider as unknown as {
          client: { responses: { create: ReturnType<typeof vi.fn> } };
        }
      ).client;
      client.responses.create.mockResolvedValue({
        id: 'resp-test',
        model: 'gpt-4o',
        output_text: 'Hi there!',
        output: [],
        usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 },
        status: 'completed',
      });

      const result = await provider.chat(messages, { model: 'gpt-4o' });

      expect(result.role).toBe('assistant');
      expect(result.content).toBe('Hi there!');
      expect((result as { usage?: unknown }).usage).toEqual({
        promptTokens: 4,
        completionTokens: 3,
        totalTokens: 7,
      });
      expect(client.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o',
          input: [expect.objectContaining({ role: 'user', content: 'Hello' })],
        }),
        undefined,
      );
    });

    it('maps function tools and function_call output items through Responses', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test' });
      const messages: TUniversalMessage[] = [createUserMessage('Weather in Seoul')];
      const client = (
        provider as unknown as {
          client: { responses: { create: ReturnType<typeof vi.fn> } };
        }
      ).client;
      client.responses.create.mockResolvedValue({
        id: 'resp-tools',
        output_text: '',
        output: [
          {
            type: 'function_call',
            call_id: 'call_weather',
            name: 'get_weather',
            arguments: '{"city":"Seoul"}',
          },
        ],
        status: 'completed',
      });

      const result = await provider.chat(messages, {
        model: 'gpt-4o',
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object' as const, properties: { city: { type: 'string' } } },
          },
        ],
      });

      expect(client.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            expect.objectContaining({
              type: 'function',
              name: 'get_weather',
              strict: false,
            }),
          ],
          tool_choice: 'auto',
        }),
        undefined,
      );
      expect((result as { toolCalls?: unknown[] }).toolCalls).toEqual([
        {
          id: 'call_weather',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Seoul"}' },
        },
      ]);
    });

    it('maps structured outputs to Responses text.format', async () => {
      const provider = new OpenAIProvider({
        apiKey: 'sk-test',
        responseFormat: 'json_schema',
        jsonSchema: {
          name: 'person',
          schema: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
            additionalProperties: false,
          },
          strict: true,
        },
      });
      const client = (
        provider as unknown as {
          client: { responses: { create: ReturnType<typeof vi.fn> } };
        }
      ).client;
      client.responses.create.mockResolvedValue({
        output_text: '{"name":"Jane"}',
        output: [],
        status: 'completed',
      });

      await provider.chat([createUserMessage('Jane, 54')], { model: 'gpt-4o' });

      expect(client.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          text: {
            format: expect.objectContaining({
              type: 'json_schema',
              name: 'person',
              strict: true,
            }),
          },
        }),
        undefined,
      );
    });

    it('streams Responses text deltas and returns an assembled message', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test' });
      const client = (
        provider as unknown as {
          client: { responses: { create: ReturnType<typeof vi.fn> } };
        }
      ).client;
      async function* streamResponses() {
        yield { type: 'response.output_text.delta', delta: 'Hello' };
        yield { type: 'response.output_text.delta', delta: ' world' };
        yield {
          type: 'response.completed',
          response: {
            id: 'resp-stream',
            output_text: 'Hello world',
            output: [],
            status: 'completed',
          },
        };
      }
      client.responses.create.mockResolvedValue(streamResponses());
      const deltas: string[] = [];

      const result = await provider.chat([createUserMessage('Hello')], {
        model: 'gpt-4o',
        onTextDelta: (delta) => deltas.push(delta),
      });

      expect(deltas).toEqual(['Hello', ' world']);
      expect(result.content).toBe('Hello world');
      expect(client.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-4o', stream: true }),
        undefined,
      );
    });

    it('yields Responses chatStream deltas before the stream completes', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test' });
      const client = (
        provider as unknown as {
          client: { responses: { create: ReturnType<typeof vi.fn> } };
        }
      ).client;
      let releaseSecondDelta: (() => void) | undefined;
      let streamCompleted = false;
      const secondDeltaGate = new Promise<void>((resolve) => {
        releaseSecondDelta = resolve;
      });
      async function* streamResponses() {
        yield { type: 'response.output_text.delta', delta: 'Hello' };
        await secondDeltaGate;
        yield { type: 'response.output_text.delta', delta: ' world' };
        yield {
          type: 'response.completed',
          response: {
            id: 'resp-stream-live',
            output_text: 'Hello world',
            output: [],
            status: 'completed',
          },
        };
        streamCompleted = true;
      }
      client.responses.create.mockResolvedValue(streamResponses());

      const stream = provider.chatStream([createUserMessage('Hello')], { model: 'gpt-4o' });
      const iterator = stream[Symbol.asyncIterator]();

      const first = await iterator.next();
      expect(first.done).toBe(false);
      expect(first.value.content).toBe('Hello');
      expect(streamCompleted).toBe(false);

      releaseSecondDelta?.();
      const second = await iterator.next();
      const final = await iterator.next();

      expect(second.value.content).toBe(' world');
      expect(final.value.content).toBe('');
      expect(final.value.metadata?.isComplete).toBe(true);
      expect(streamCompleted).toBe(true);
    });

    it('keeps baseURL profiles on Chat Completions by default', async () => {
      const provider = new OpenAIProvider({
        apiKey: 'local-key',
        baseURL: 'http://localhost:1234/v1',
        defaultModel: 'local-model',
      });
      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: 'local result' },
            finish_reason: 'stop',
          },
        ],
      });

      await provider.chat([createUserMessage('Hello')]);

      expect(client.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'local-model' }),
      );
    });
  });

  describe('chat (direct API path)', () => {
    it('should throw when model is not specified', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      const messages: TUniversalMessage[] = [createUserMessage('Hello')];

      await expect(provider.chat(messages, {})).rejects.toThrow(
        'OpenAI chat failed: Model is required in chat options',
      );
    });

    it('should throw when client is not available', async () => {
      const mockExecutor = {
        chat: vi.fn().mockRejectedValue(new Error('Executor error')),
        chatStream: vi.fn(),
      };
      const provider = new OpenAIProvider({ executor: mockExecutor as never });
      const messages: TUniversalMessage[] = [createUserMessage('Hello')];

      await expect(provider.chat(messages, { model: 'gpt-4' })).rejects.toThrow();
    });

    it('should call OpenAI API with correct parameters', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      const messages: TUniversalMessage[] = [
        createSystemMessage('You are helpful'),
        createUserMessage('Hello'),
      ];

      // Access the mocked client
      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockResolvedValue({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hi there!', refusal: null },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
      });

      const result = await provider.chat(messages, {
        model: 'gpt-4',
        temperature: 0.5,
        maxTokens: 100,
      });

      expect(result.role).toBe('assistant');
      expect(result.content).toBe('Hi there!');
      expect(client.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4',
          temperature: 0.5,
          max_tokens: 100,
        }),
      );
    });

    it('should include tools in request when provided', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      const messages: TUniversalMessage[] = [createUserMessage('Search')];

      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockResolvedValue({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Result', refusal: null },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
      });

      const tools = [
        {
          name: 'search',
          description: 'Search web',
          parameters: { type: 'object' as const, properties: {} },
        },
      ];

      await provider.chat(messages, { model: 'gpt-4', tools });

      expect(client.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({
              type: 'function',
              function: expect.objectContaining({ name: 'search' }),
            }),
          ]),
          tool_choice: 'auto',
        }),
      );
    });

    it('should wrap API errors with descriptive message', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      const messages: TUniversalMessage[] = [createUserMessage('Hello')];

      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockRejectedValue(new Error('Insufficient quota'));

      await expect(provider.chat(messages, { model: 'gpt-4' })).rejects.toThrow(
        'OpenAI chat failed: Insufficient quota',
      );
    });

    it('should call payload logger when enabled', async () => {
      const payloadLogger = createMockPayloadLogger(true);
      const provider = new OpenAIProvider({
        apiKey: 'sk-test',
        apiSurface: 'chat-completions',
        payloadLogger,
      });
      const messages: TUniversalMessage[] = [createUserMessage('Hello')];

      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockResolvedValue({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hi', refusal: null },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
      });

      await provider.chat(messages, { model: 'gpt-4' });

      expect(payloadLogger.logPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4',
          messagesCount: 1,
        }),
        'chat',
      );
    });

    it('should not call payload logger when disabled', async () => {
      const payloadLogger = createMockPayloadLogger(false);
      const provider = new OpenAIProvider({
        apiKey: 'sk-test',
        apiSurface: 'chat-completions',
        payloadLogger,
      });
      const messages: TUniversalMessage[] = [createUserMessage('Hello')];

      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockResolvedValue({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hi', refusal: null },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
      });

      await provider.chat(messages, { model: 'gpt-4' });

      expect(payloadLogger.logPayload).not.toHaveBeenCalled();
    });

    it('should convert all message types correctly', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      const messages: TUniversalMessage[] = [
        createSystemMessage('System prompt'),
        createUserMessage('User question'),
        {
          id: 'msg-3',
          state: 'complete' as const,
          role: 'assistant',
          content: null,
          toolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'calc', arguments: '{"a":1}' },
            },
          ],
          timestamp: new Date(),
        },
        {
          id: 'msg-4',
          state: 'complete' as const,
          role: 'tool',
          content: '{"result":42}',
          toolCallId: 'call_1',
          name: 'calc',
          timestamp: new Date(),
        },
      ];

      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockResolvedValue({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Done', refusal: null },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
      });

      await provider.chat(messages, { model: 'gpt-4' });

      expect(client.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system', content: 'System prompt' }),
            expect.objectContaining({ role: 'user', content: 'User question' }),
            expect.objectContaining({
              role: 'assistant',
              content: null,
              tool_calls: expect.arrayContaining([expect.objectContaining({ id: 'call_1' })]),
            }),
            expect.objectContaining({
              role: 'tool',
              tool_call_id: 'call_1',
            }),
          ]),
        }),
      );
    });
  });

  describe('chatStream (direct API path)', () => {
    it('should throw when model is not specified', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      const messages: TUniversalMessage[] = [createUserMessage('Hello')];

      await expect(async () => {
        for await (const _chunk of provider.chatStream(messages, {})) {
          // consume
        }
      }).rejects.toThrow('OpenAI stream failed: Model is required in chat options');
    });

    it('should throw when client is not available (executor mode)', async () => {
      const mockExecutor = {
        chat: vi.fn(),
        chatStream: vi.fn().mockImplementation(function () {
          throw new Error('Executor stream error');
        }),
      };
      const provider = new OpenAIProvider({ executor: mockExecutor as never });
      const messages: TUniversalMessage[] = [createUserMessage('Hello')];

      await expect(async () => {
        for await (const _chunk of provider.chatStream(messages, { model: 'gpt-4' })) {
          // consume
        }
      }).rejects.toThrow();
    });

    it('should yield streaming chunks from OpenAI API', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      const messages: TUniversalMessage[] = [createUserMessage('Hello')];

      // Create async iterable mock stream
      async function* mockStream() {
        yield {
          id: 'chunk-1',
          object: 'chat.completion.chunk',
          created: Date.now(),
          model: 'gpt-4',
          choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null, logprobs: null }],
        };
        yield {
          id: 'chunk-2',
          object: 'chat.completion.chunk',
          created: Date.now(),
          model: 'gpt-4',
          choices: [
            { index: 0, delta: { content: ' world' }, finish_reason: null, logprobs: null },
          ],
        };
        yield {
          id: 'chunk-3',
          object: 'chat.completion.chunk',
          created: Date.now(),
          model: 'gpt-4',
          choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop', logprobs: null }],
        };
      }

      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockResolvedValue(mockStream());

      const results: TUniversalMessage[] = [];
      for await (const chunk of provider.chatStream(messages, { model: 'gpt-4' })) {
        results.push(chunk);
      }

      expect(results).toHaveLength(3);
      expect(results[0].content).toBe('Hello');
      expect(results[1].content).toBe(' world');
    });

    it('should wrap API errors with descriptive message for streaming', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      const messages: TUniversalMessage[] = [createUserMessage('Hello')];

      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockRejectedValue(new Error('Rate limit exceeded'));

      await expect(async () => {
        for await (const _chunk of provider.chatStream(messages, { model: 'gpt-4' })) {
          // consume
        }
      }).rejects.toThrow('OpenAI stream failed: Rate limit exceeded');
    });

    it('should call payload logger for stream when enabled', async () => {
      const payloadLogger = createMockPayloadLogger(true);
      const provider = new OpenAIProvider({
        apiKey: 'sk-test',
        apiSurface: 'chat-completions',
        payloadLogger,
      });
      const messages: TUniversalMessage[] = [createUserMessage('Hello')];

      async function* mockStream() {
        yield {
          id: 'chunk-1',
          object: 'chat.completion.chunk',
          created: Date.now(),
          model: 'gpt-4',
          choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: 'stop', logprobs: null }],
        };
      }

      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockResolvedValue(mockStream());

      for await (const _chunk of provider.chatStream(messages, { model: 'gpt-4' })) {
        // consume
      }

      expect(payloadLogger.logPayload).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-4' }),
        'stream',
      );
    });

    it('should include tools in streaming request when provided', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      const messages: TUniversalMessage[] = [createUserMessage('Search')];

      async function* mockStream() {
        yield {
          id: 'chunk-1',
          object: 'chat.completion.chunk',
          created: Date.now(),
          model: 'gpt-4',
          choices: [
            { index: 0, delta: { content: 'Result' }, finish_reason: 'stop', logprobs: null },
          ],
        };
      }

      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockResolvedValue(mockStream());

      const tools = [
        {
          name: 'search',
          description: 'Search web',
          parameters: { type: 'object' as const, properties: {} },
        },
      ];

      for await (const _chunk of provider.chatStream(messages, { model: 'gpt-4', tools })) {
        // consume
      }

      expect(client.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          stream: true,
          tools: expect.arrayContaining([
            expect.objectContaining({
              type: 'function',
              function: expect.objectContaining({ name: 'search' }),
            }),
          ]),
          tool_choice: 'auto',
        }),
        undefined,
      );
    });
  });

  describe('chat streaming assembly', () => {
    async function* createTextStream() {
      yield {
        id: 'chunk-1',
        object: 'chat.completion.chunk',
        created: Date.now(),
        model: 'gpt-4',
        choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null, logprobs: null }],
      };
      yield {
        id: 'chunk-2',
        object: 'chat.completion.chunk',
        created: Date.now(),
        model: 'gpt-4',
        choices: [{ index: 0, delta: { content: ' world' }, finish_reason: null, logprobs: null }],
      };
      yield {
        id: 'chunk-3',
        object: 'chat.completion.chunk',
        created: Date.now(),
        model: 'gpt-4',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop', logprobs: null }],
      };
    }

    async function* createToolCallStream() {
      yield {
        id: 'chunk-1',
        object: 'chat.completion.chunk',
        created: Date.now(),
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_weather',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{"city"' },
                },
              ],
            },
            finish_reason: null,
            logprobs: null,
          },
        ],
      };
      yield {
        id: 'chunk-2',
        object: 'chat.completion.chunk',
        created: Date.now(),
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: ':"Seoul"}' },
                },
              ],
            },
            finish_reason: null,
            logprobs: null,
          },
        ],
      };
      yield {
        id: 'chunk-3',
        object: 'chat.completion.chunk',
        created: Date.now(),
        model: 'gpt-4',
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls', logprobs: null }],
      };
    }

    it('streams text through onTextDelta and returns an assembled message', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      const messages: TUniversalMessage[] = [createUserMessage('Hello')];
      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockResolvedValue(createTextStream());
      const deltas: string[] = [];

      const result = await provider.chat(messages, {
        model: 'gpt-4',
        onTextDelta: (delta) => deltas.push(delta),
      });

      expect(deltas).toEqual(['Hello', ' world']);
      expect(result.content).toBe('Hello world');
      expect(client.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-4', stream: true }),
        undefined,
      );
    });

    it('streams through the provider-level onTextDelta callback when configured by Session', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      const messages: TUniversalMessage[] = [createUserMessage('Hello')];
      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockResolvedValue(createTextStream());
      const deltas: string[] = [];
      provider.onTextDelta = (delta) => deltas.push(delta);

      const result = await provider.chat(messages, {
        model: 'gpt-4',
      });

      expect(deltas).toEqual(['Hello', ' world']);
      expect(result.content).toBe('Hello world');
      expect(client.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-4', stream: true }),
        undefined,
      );
    });

    it('assembles streaming tool-call deltas before returning', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      const messages: TUniversalMessage[] = [createUserMessage('Weather in Seoul')];
      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockResolvedValue(createToolCallStream());

      const result = await provider.chat(messages, {
        model: 'gpt-4',
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object' as const, properties: { city: { type: 'string' } } },
          },
        ],
        onTextDelta: vi.fn(),
      });

      const assistant = result as TUniversalMessage & {
        toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
      expect(assistant.content).toBe('');
      expect(assistant.toolCalls).toEqual([
        {
          id: 'call_weather',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Seoul"}' },
        },
      ]);
    });

    it('passes AbortSignal to the streaming request used by chat', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      const messages: TUniversalMessage[] = [createUserMessage('Hello')];
      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockResolvedValue(createTextStream());
      const controller = new AbortController();

      await provider.chat(messages, {
        model: 'gpt-4',
        onTextDelta: vi.fn(),
        signal: controller.signal,
      });

      expect(client.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ stream: true }),
        { signal: controller.signal },
      );
    });
  });

  describe('validateMessages', () => {
    it('should accept valid messages', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      const messages: TUniversalMessage[] = [
        createSystemMessage('System'),
        createUserMessage('User'),
      ];

      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockResolvedValue({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'OK', refusal: null },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
      });

      // Should not throw
      await expect(provider.chat(messages, { model: 'gpt-4' })).resolves.toBeDefined();
    });

    it('should accept assistant message with empty content and tool calls', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      const messages: TUniversalMessage[] = [
        createUserMessage('Calculate'),
        {
          id: 'msg-2',
          state: 'complete' as const,
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'calc', arguments: '{}' },
            },
          ],
          timestamp: new Date(),
        },
        {
          id: 'msg-3',
          state: 'complete' as const,
          role: 'tool',
          content: '42',
          toolCallId: 'call_1',
          name: 'calc',
          timestamp: new Date(),
        },
      ];

      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockResolvedValue({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '42', refusal: null },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
      });

      // Should not throw
      await expect(provider.chat(messages, { model: 'gpt-4' })).resolves.toBeDefined();
    });
  });

  describe('message conversion (private convertToOpenAIMessages)', () => {
    it('should convert assistant message with empty content and tool calls to null content', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      const messages: TUniversalMessage[] = [
        createUserMessage('Hi'),
        {
          id: 'msg-2',
          state: 'complete' as const,
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'fn', arguments: '{}' },
            },
          ],
          timestamp: new Date(),
        },
      ];

      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockResolvedValue({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'OK', refusal: null },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
      });

      await provider.chat(messages, { model: 'gpt-4' });

      const apiMessages = client.chat.completions.create.mock.calls[0][0].messages;
      // Assistant message with tool calls and empty content should have null content
      const assistantMsg = apiMessages.find((m: { role: string }) => m.role === 'assistant');
      expect(assistantMsg.content).toBeNull();
    });

    it('should convert regular assistant message content to string', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface: 'chat-completions' });
      const messages: TUniversalMessage[] = [
        createUserMessage('Hi'),
        {
          id: 'msg-2',
          state: 'complete' as const,
          role: 'assistant',
          content: 'Hello!',
          timestamp: new Date(),
        },
      ];

      const client = (
        provider as unknown as {
          client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
        }
      ).client;
      client.chat.completions.create.mockResolvedValue({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'OK', refusal: null },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
      });

      await provider.chat(messages, { model: 'gpt-4' });

      const apiMessages = client.chat.completions.create.mock.calls[0][0].messages;
      const assistantMsg = apiMessages.find((m: { role: string }) => m.role === 'assistant');
      expect(assistantMsg.content).toBe('Hello!');
    });
  });
});
