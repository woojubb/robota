import { describe, it, expect, vi } from 'vitest';
import { OpenAIResponseParser } from './response-parser';
import type { ILogger } from '@robota-sdk/agent-core';
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

function createChatCompletion(
  overrides: Partial<OpenAI.Chat.ChatCompletion> = {},
): OpenAI.Chat.ChatCompletion {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: Date.now(),
    model: 'gpt-4',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Hello!',
          refusal: null,
        },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    ...overrides,
  } as OpenAI.Chat.ChatCompletion;
}

function createStreamChunk(
  overrides: Record<string, unknown> = {},
): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: 'chatcmpl-chunk',
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'gpt-4',
    choices: [
      {
        index: 0,
        delta: { content: 'Hi' },
        finish_reason: null,
        logprobs: null,
      },
    ],
    ...overrides,
  } as OpenAI.Chat.ChatCompletionChunk;
}

describe('OpenAIResponseParser', () => {
  describe('constructor', () => {
    it('should use SilentLogger when no logger is provided', () => {
      const parser = new OpenAIResponseParser();
      // Parser should work without throwing
      const response = createChatCompletion();
      const result = parser.parseResponse(response);
      expect(result.role).toBe('assistant');
    });

    it('should accept a custom logger', () => {
      const logger = createMockLogger();
      const parser = new OpenAIResponseParser(logger);
      const response = createChatCompletion();
      const result = parser.parseResponse(response);
      expect(result.role).toBe('assistant');
    });
  });

  describe('parseResponse', () => {
    it('should parse a simple text response', () => {
      const parser = new OpenAIResponseParser();
      const response = createChatCompletion();
      const result = parser.parseResponse(response);

      expect(result.role).toBe('assistant');
      expect(result.content).toBe('Hello!');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should parse response with empty content as empty string', () => {
      const parser = new OpenAIResponseParser();
      const response = createChatCompletion({
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: null, refusal: null },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
      });
      const result = parser.parseResponse(response);
      expect(result.content).toBe('');
    });

    it('should parse response with tool calls', () => {
      const parser = new OpenAIResponseParser();
      const response = createChatCompletion({
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              refusal: null,
              tool_calls: [
                {
                  id: 'call_abc',
                  type: 'function',
                  function: {
                    name: 'calculate',
                    arguments: '{"a":1,"b":2}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
            logprobs: null,
          },
        ],
      });

      const result = parser.parseResponse(response);
      expect(result.role).toBe('assistant');
      expect(result.content).toBe('');
      expect(result).toHaveProperty('toolCalls');
      const assistantResult = result as {
        toolCalls: Array<{
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }>;
      };
      expect(assistantResult.toolCalls).toHaveLength(1);
      expect(assistantResult.toolCalls[0].id).toBe('call_abc');
      expect(assistantResult.toolCalls[0].function.name).toBe('calculate');
      expect(assistantResult.toolCalls[0].function.arguments).toBe('{"a":1,"b":2}');
    });

    it('should parse response with usage information', () => {
      const parser = new OpenAIResponseParser();
      const response = createChatCompletion({
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      });

      const result = parser.parseResponse(response);
      expect(result).toHaveProperty('usage');
      const withUsage = result as unknown as {
        usage: { promptTokens: number; completionTokens: number; totalTokens: number };
      };
      expect(withUsage.usage.promptTokens).toBe(10);
      expect(withUsage.usage.completionTokens).toBe(20);
      expect(withUsage.usage.totalTokens).toBe(30);
    });

    it('should include finishReason in metadata', () => {
      const parser = new OpenAIResponseParser();
      const response = createChatCompletion();
      const result = parser.parseResponse(response);
      expect(result.metadata?.finishReason).toBe('stop');
    });

    it('should throw when response has no choices', () => {
      const parser = new OpenAIResponseParser();
      const response = createChatCompletion({ choices: [] });

      expect(() => parser.parseResponse(response)).toThrow('OpenAI response parsing failed');
    });

    it('should throw with descriptive error and log on parsing failure', () => {
      const logger = createMockLogger();
      const parser = new OpenAIResponseParser(logger);
      const response = createChatCompletion({ choices: [] });

      expect(() => parser.parseResponse(response)).toThrow(
        'OpenAI response parsing failed: No choices found in OpenAI response',
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle response without usage field', () => {
      const parser = new OpenAIResponseParser();
      const response = createChatCompletion();
      // Default createChatCompletion has no usage
      const result = parser.parseResponse(response);
      expect(result).not.toHaveProperty('usage');
    });

    it('should parse response with multiple tool calls', () => {
      const parser = new OpenAIResponseParser();
      const response = createChatCompletion({
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              refusal: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'fn1', arguments: '{}' },
                },
                {
                  id: 'call_2',
                  type: 'function',
                  function: { name: 'fn2', arguments: '{"x":1}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
            logprobs: null,
          },
        ],
      });

      const result = parser.parseResponse(response);
      const assistantResult = result as { toolCalls: Array<{ id: string }> };
      expect(assistantResult.toolCalls).toHaveLength(2);
      expect(assistantResult.toolCalls[0].id).toBe('call_1');
      expect(assistantResult.toolCalls[1].id).toBe('call_2');
    });
  });

  describe('parseStreamingChunk', () => {
    it('should parse a chunk with content', () => {
      const parser = new OpenAIResponseParser();
      const chunk = createStreamChunk();
      const result = parser.parseStreamingChunk(chunk);

      expect(result).not.toBeNull();
      expect(result!.role).toBe('assistant');
      expect(result!.content).toBe('Hi');
      expect(result!.metadata?.isStreamChunk).toBe(true);
      expect(result!.metadata?.isComplete).toBe(false);
    });

    it('should return null when chunk has no choices', () => {
      const parser = new OpenAIResponseParser();
      const chunk = createStreamChunk({ choices: [] });
      const result = parser.parseStreamingChunk(chunk);
      expect(result).toBeNull();
    });

    it('should handle chunk with empty content', () => {
      const parser = new OpenAIResponseParser();
      const chunk = createStreamChunk({
        choices: [
          {
            index: 0,
            delta: { content: '' },
            finish_reason: null,
          },
        ],
      });
      const result = parser.parseStreamingChunk(chunk);
      expect(result).not.toBeNull();
      expect(result!.content).toBe('');
    });

    it('should mark chunk as complete when finish_reason is stop', () => {
      const parser = new OpenAIResponseParser();
      const chunk = createStreamChunk({
        choices: [
          {
            index: 0,
            delta: { content: '' },
            finish_reason: 'stop',
          },
        ],
      });
      const result = parser.parseStreamingChunk(chunk);
      expect(result!.metadata?.isComplete).toBe(true);
    });

    it('should mark chunk as complete when finish_reason is tool_calls', () => {
      const parser = new OpenAIResponseParser();
      const chunk = createStreamChunk({
        choices: [
          {
            index: 0,
            delta: { content: '' },
            finish_reason: 'tool_calls',
          },
        ],
      });
      const result = parser.parseStreamingChunk(chunk);
      expect(result!.metadata?.isComplete).toBe(true);
    });

    it('should parse chunk with tool calls', () => {
      const parser = new OpenAIResponseParser();
      const chunk = createStreamChunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_stream_1',
                  type: 'function',
                  function: {
                    name: 'search',
                    arguments: '{"q":"test"}',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });

      const result = parser.parseStreamingChunk(chunk);
      expect(result).not.toBeNull();
      expect(result!.role).toBe('assistant');
      expect(result!.content).toBe('');
      const withToolCalls = result as unknown as {
        toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
      expect(withToolCalls.toolCalls).toHaveLength(1);
      expect(withToolCalls.toolCalls[0].id).toBe('call_stream_1');
      expect(withToolCalls.toolCalls[0].function.name).toBe('search');
    });

    it('should handle chunk with tool calls missing optional fields', () => {
      const parser = new OpenAIResponseParser();
      const chunk = createStreamChunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  // Missing id, function.name, function.arguments
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });

      const result = parser.parseStreamingChunk(chunk);
      expect(result).not.toBeNull();
      const withToolCalls = result as unknown as {
        toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
      expect(withToolCalls.toolCalls[0].id).toBe('');
      expect(withToolCalls.toolCalls[0].function.name).toBe('');
      expect(withToolCalls.toolCalls[0].function.arguments).toBe('');
    });

    it('should handle chunk with no delta content (undefined)', () => {
      const parser = new OpenAIResponseParser();
      const chunk = createStreamChunk({
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: null,
          },
        ],
      });
      const result = parser.parseStreamingChunk(chunk);
      expect(result).not.toBeNull();
      expect(result!.content).toBe('');
    });

    it('should throw with descriptive error on parsing failure', () => {
      const logger = createMockLogger();
      const parser = new OpenAIResponseParser(logger);

      // Force an error by passing a chunk that causes internal error
      const badChunk = {
        choices: [
          {
            get delta(): never {
              throw new Error('Access error');
            },
            finish_reason: null,
          },
        ],
      } as unknown as OpenAI.Chat.ChatCompletionChunk;

      expect(() => parser.parseStreamingChunk(badChunk)).toThrow('OpenAI chunk parsing failed');
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
