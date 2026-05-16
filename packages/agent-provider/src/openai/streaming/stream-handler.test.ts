import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIStreamHandler } from './stream-handler';
import type { IPayloadLogger } from '../interfaces/payload-logger';
import type { ILogger } from '@robota-sdk/agent-core';
import type { IOpenAIStreamRequestParams, IOpenAIChatRequestParams } from '../types/api-types';
import type OpenAI from 'openai';

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

// Create an async iterable from an array of chunks
async function* asyncIterableFrom<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

function createMockClient(chunks: OpenAI.Chat.ChatCompletionChunk[]): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue(asyncIterableFrom(chunks)),
      },
    },
  } as unknown as OpenAI;
}

function createStreamChunk(
  content: string,
  finishReason: string | null = null,
): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: 'chatcmpl-chunk',
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'gpt-4',
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
  } as OpenAI.Chat.ChatCompletionChunk;
}

describe('OpenAIStreamHandler', () => {
  let mockClient: OpenAI;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleStream', () => {
    it('should yield parsed messages from stream', async () => {
      const chunks = [
        createStreamChunk('Hello'),
        createStreamChunk(' world'),
        createStreamChunk('', 'stop'),
      ];
      mockClient = createMockClient(chunks);
      const handler = new OpenAIStreamHandler(mockClient);

      const requestParams: IOpenAIStreamRequestParams = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      };

      const results: Array<{ content: string | null }> = [];
      for await (const msg of handler.handleStream(requestParams)) {
        results.push(msg);
      }

      expect(results).toHaveLength(3);
      expect(results[0].content).toBe('Hello');
      expect(results[1].content).toBe(' world');
    });

    it('should log payload when payload logger is enabled', async () => {
      const chunks = [createStreamChunk('Hi', 'stop')];
      mockClient = createMockClient(chunks);
      const payloadLogger = createMockPayloadLogger(true);
      const handler = new OpenAIStreamHandler(mockClient, payloadLogger);

      const requestParams: IOpenAIStreamRequestParams = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
        temperature: 0.5,
        max_tokens: 100,
      };

      const results = [];
      for await (const msg of handler.handleStream(requestParams)) {
        results.push(msg);
      }

      expect(payloadLogger.logPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4',
          messagesCount: 1,
          hasTools: false,
          temperature: 0.5,
          maxTokens: 100,
        }),
        'stream',
      );
    });

    it('should not log payload when payload logger is disabled', async () => {
      const chunks = [createStreamChunk('Hi', 'stop')];
      mockClient = createMockClient(chunks);
      const payloadLogger = createMockPayloadLogger(false);
      const handler = new OpenAIStreamHandler(mockClient, payloadLogger);

      const requestParams: IOpenAIStreamRequestParams = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      };

      for await (const _msg of handler.handleStream(requestParams)) {
        // consume stream
      }

      expect(payloadLogger.logPayload).not.toHaveBeenCalled();
    });

    it('should pass tools and tool_choice to API when provided', async () => {
      const chunks = [createStreamChunk('Hi', 'stop')];
      mockClient = createMockClient(chunks);
      const handler = new OpenAIStreamHandler(mockClient);

      const tools: OpenAI.Chat.ChatCompletionTool[] = [
        {
          type: 'function',
          function: {
            name: 'search',
            description: 'Search the web',
            parameters: { type: 'object', properties: {} },
          },
        },
      ];

      const requestParams: IOpenAIStreamRequestParams = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
        tools,
        tool_choice: 'auto',
      };

      for await (const _msg of handler.handleStream(requestParams)) {
        // consume
      }

      const createCall = vi.mocked(mockClient.chat.completions.create);
      expect(createCall).toHaveBeenCalledWith(
        expect.objectContaining({
          tools,
          tool_choice: 'auto',
          stream: true,
        }),
      );
    });

    it('should throw with descriptive error when API call fails', async () => {
      mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue(new Error('API rate limit')),
          },
        },
      } as unknown as OpenAI;

      const logger = createMockLogger();
      const handler = new OpenAIStreamHandler(mockClient, undefined, logger);

      const requestParams: IOpenAIStreamRequestParams = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      };

      const results = [];
      await expect(async () => {
        for await (const msg of handler.handleStream(requestParams)) {
          results.push(msg);
        }
      }).rejects.toThrow('OpenAI streaming failed: API rate limit');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle empty stream', async () => {
      mockClient = createMockClient([]);
      const handler = new OpenAIStreamHandler(mockClient);

      const requestParams: IOpenAIStreamRequestParams = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      };

      const results = [];
      for await (const msg of handler.handleStream(requestParams)) {
        results.push(msg);
      }

      expect(results).toHaveLength(0);
    });

    it('should work without payload logger', async () => {
      const chunks = [createStreamChunk('Hello', 'stop')];
      mockClient = createMockClient(chunks);
      const handler = new OpenAIStreamHandler(mockClient);

      const requestParams: IOpenAIStreamRequestParams = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      };

      const results = [];
      for await (const msg of handler.handleStream(requestParams)) {
        results.push(msg);
      }

      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Hello');
    });
  });

  describe('generateStreamingResponse', () => {
    it('should convert chat request params and delegate to handleStream', async () => {
      const chunks = [createStreamChunk('Response'), createStreamChunk('', 'stop')];
      mockClient = createMockClient(chunks);
      const handler = new OpenAIStreamHandler(mockClient);

      const request: IOpenAIChatRequestParams = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        temperature: 0.8,
        max_tokens: 200,
      };

      const results = [];
      for await (const msg of handler.generateStreamingResponse(request)) {
        results.push(msg);
      }

      expect(results).toHaveLength(2);
      expect(results[0].content).toBe('Response');
    });

    it('should default model to gpt-4o-mini when not specified', async () => {
      const chunks = [createStreamChunk('Hi', 'stop')];
      mockClient = createMockClient(chunks);
      const handler = new OpenAIStreamHandler(mockClient);

      const request: IOpenAIChatRequestParams = {
        model: '',
        messages: [{ role: 'user', content: 'Hi' }],
      };

      for await (const _msg of handler.generateStreamingResponse(request)) {
        // consume
      }

      const createCall = vi.mocked(mockClient.chat.completions.create);
      expect(createCall).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o-mini' }));
    });

    it('should include tools when provided in request', async () => {
      const chunks = [createStreamChunk('Hi', 'stop')];
      mockClient = createMockClient(chunks);
      const handler = new OpenAIStreamHandler(mockClient);

      const tools: OpenAI.Chat.ChatCompletionTool[] = [
        {
          type: 'function',
          function: {
            name: 'calc',
            description: 'Calculate',
            parameters: { type: 'object', properties: {} },
          },
        },
      ];

      const request: IOpenAIChatRequestParams = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        tools,
      };

      for await (const _msg of handler.generateStreamingResponse(request)) {
        // consume
      }

      const createCall = vi.mocked(mockClient.chat.completions.create);
      expect(createCall).toHaveBeenCalledWith(
        expect.objectContaining({
          tools,
          tool_choice: 'auto',
        }),
      );
    });

    it('should throw and log error when streaming fails', async () => {
      mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue(new Error('Network error')),
          },
        },
      } as unknown as OpenAI;

      const logger = createMockLogger();
      const handler = new OpenAIStreamHandler(mockClient, undefined, logger);

      const request: IOpenAIChatRequestParams = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      };

      await expect(async () => {
        for await (const _msg of handler.generateStreamingResponse(request)) {
          // consume
        }
      }).rejects.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle empty messages array', async () => {
      const chunks = [createStreamChunk('Hi', 'stop')];
      mockClient = createMockClient(chunks);
      const handler = new OpenAIStreamHandler(mockClient);

      const request: IOpenAIChatRequestParams = {
        model: 'gpt-4',
        messages: [],
      };

      const results = [];
      for await (const msg of handler.generateStreamingResponse(request)) {
        results.push(msg);
      }

      expect(results).toHaveLength(1);
    });
  });
});
