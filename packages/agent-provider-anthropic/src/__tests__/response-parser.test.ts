import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';

// Mock the logger from @robota-sdk/agent-core
vi.mock('@robota-sdk/agent-core', async () => {
  const actual = await vi.importActual('@robota-sdk/agent-core');
  return {
    ...actual,
    logger: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    },
  };
});

import { AnthropicResponseParser } from '../parsers/response-parser';
import { logger } from '@robota-sdk/agent-core';
import type { IAssistantMessage } from '@robota-sdk/agent-core';
import type { IAnthropicMessage } from '../types/api-types';

/** Helper to cast parseResponse result to IAssistantMessage with usage for test assertions */
type TAssistantWithUsage = IAssistantMessage & {
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
};

// Helper: build a minimal IAnthropicMessage
function makeMessage(overrides: Partial<IAnthropicMessage> = {}): IAnthropicMessage {
  return {
    id: 'msg_123',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello' }],
    model: 'claude-3-opus-20240229',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
    ...overrides,
  };
}

describe('AnthropicResponseParser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── parseResponse ────────────────────────────────────────────

  describe('parseResponse', () => {
    it('should parse a basic text response', () => {
      const msg = makeMessage();
      const result = AnthropicResponseParser.parseResponse(msg);

      expect(result.role).toBe('assistant');
      expect(result.content).toBe('Hello');
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.metadata?.model).toBe('claude-3-opus-20240229');
      expect(result.metadata?.finishReason).toBe('end_turn');
    });

    it('should extract token usage', () => {
      const msg = makeMessage({
        usage: { input_tokens: 50, output_tokens: 100 },
      });
      const result = AnthropicResponseParser.parseResponse(msg) as TAssistantWithUsage;

      expect(result.usage).toEqual({
        promptTokens: 50,
        completionTokens: 100,
        totalTokens: 150,
      });
    });

    it('should handle missing usage gracefully', () => {
      const msg = makeMessage();
      // Remove usage to test undefined path
      (msg as unknown as Record<string, unknown>).usage = undefined;
      const result = AnthropicResponseParser.parseResponse(msg) as TAssistantWithUsage;

      expect(result.usage).toBeUndefined();
    });

    it('should parse tool_use blocks into toolCalls', () => {
      const msg = makeMessage({
        content: [
          { type: 'text', text: '' },
          {
            type: 'tool_use',
            id: 'tool_call_1',
            name: 'get_weather',
            input: { city: 'Seoul' },
          },
        ],
      });

      const result = AnthropicResponseParser.parseResponse(msg) as IAssistantMessage;

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        id: 'tool_call_1',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: JSON.stringify({ city: 'Seoul' }),
        },
      });
    });

    it('should filter out tool_use blocks without id or name', () => {
      const msg = makeMessage({
        content: [
          { type: 'text', text: 'Hi' },
          { type: 'tool_use' }, // missing id and name
        ],
      });

      const result = AnthropicResponseParser.parseResponse(msg) as IAssistantMessage;
      expect(result.toolCalls).toBeUndefined();
    });

    it('should handle empty content array by returning empty string', () => {
      const msg = makeMessage({ content: [] });
      const result = AnthropicResponseParser.parseResponse(msg);
      expect(result.content).toBe('');
    });

    it('should use "unknown" as finishReason when stop_reason is null', () => {
      const msg = makeMessage({ stop_reason: null });
      const result = AnthropicResponseParser.parseResponse(msg);
      expect(result.metadata?.finishReason).toBe('unknown');
    });

    it('should default input to empty object when missing from tool_use block', () => {
      const msg = makeMessage({
        content: [
          {
            type: 'tool_use',
            id: 'tool_1',
            name: 'noop',
            // no input
          },
        ],
      });

      const result = AnthropicResponseParser.parseResponse(msg) as IAssistantMessage;
      expect(result.toolCalls![0].function.arguments).toBe('{}');
    });

    it('should re-throw and log errors during parsing', () => {
      // Force an error by passing an object that will fail during parsing
      const badMsg = null as unknown as IAnthropicMessage;
      expect(() => AnthropicResponseParser.parseResponse(badMsg)).toThrow();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ── parseStreamingChunk ──────────────────────────────────────

  describe('parseStreamingChunk', () => {
    it('should handle content_block_start with text type', () => {
      const chunk = {
        type: 'content_block_start' as const,
        index: 0,
        content_block: { type: 'text', text: '' },
      } as Anthropic.MessageStreamEvent;

      const result = AnthropicResponseParser.parseStreamingChunk(chunk);

      expect(result).not.toBeNull();
      expect(result!.role).toBe('assistant');
      expect(result!.content).toBe('');
      expect(result!.metadata?.isStreamChunk).toBe(true);
      expect(result!.metadata?.isComplete).toBe(false);
    });

    it('should handle content_block_start with tool_use type', () => {
      const chunk = {
        type: 'content_block_start' as const,
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tool_1',
          name: 'search',
          input: {},
        },
      } as Anthropic.MessageStreamEvent;

      const result = AnthropicResponseParser.parseStreamingChunk(chunk);

      expect(result).not.toBeNull();
      const assistantResult = result as IAssistantMessage;
      expect(assistantResult.toolCalls).toHaveLength(1);
      expect(assistantResult.toolCalls![0].id).toBe('tool_1');
      expect(assistantResult.toolCalls![0].function.name).toBe('search');
    });

    it('should handle content_block_delta with text_delta', () => {
      const chunk = {
        type: 'content_block_delta' as const,
        index: 0,
        delta: { type: 'text_delta', text: 'Hello world' },
      } as Anthropic.MessageStreamEvent;

      const result = AnthropicResponseParser.parseStreamingChunk(chunk);

      expect(result).not.toBeNull();
      expect(result!.content).toBe('Hello world');
      expect(result!.metadata?.isStreamChunk).toBe(true);
    });

    it('should handle content_block_delta with input_json_delta', () => {
      const chunk = {
        type: 'content_block_delta' as const,
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"key' },
      } as Anthropic.MessageStreamEvent;

      const result = AnthropicResponseParser.parseStreamingChunk(chunk);

      expect(result).not.toBeNull();
      expect(result!.content).toBeNull();
      expect(result!.metadata?.isStreamChunk).toBe(true);
    });

    it('should handle content_block_stop', () => {
      const chunk = {
        type: 'content_block_stop' as const,
        index: 0,
      } as Anthropic.MessageStreamEvent;

      const result = AnthropicResponseParser.parseStreamingChunk(chunk);

      expect(result).not.toBeNull();
      expect(result!.metadata?.isStreamChunk).toBe(true);
      expect(result!.metadata?.isComplete).toBe(false);
    });

    it('should handle message_stop with isComplete true', () => {
      const chunk = {
        type: 'message_stop' as const,
      } as Anthropic.MessageStreamEvent;

      const result = AnthropicResponseParser.parseStreamingChunk(chunk);

      expect(result).not.toBeNull();
      expect(result!.metadata?.isComplete).toBe(true);
    });

    it('should return null for unknown chunk types', () => {
      const chunk = {
        type: 'message_start' as const,
        message: {},
      } as Anthropic.MessageStreamEvent;

      const result = AnthropicResponseParser.parseStreamingChunk(chunk);
      expect(result).toBeNull();
    });

    it('should return null for content_block_start with unrecognized block type', () => {
      const chunk = {
        type: 'content_block_start' as const,
        index: 0,
        content_block: { type: 'image' },
      } as unknown as Anthropic.MessageStreamEvent;

      const result = AnthropicResponseParser.parseStreamingChunk(chunk);
      expect(result).toBeNull();
    });

    it('should return null for content_block_delta with unrecognized delta type', () => {
      const chunk = {
        type: 'content_block_delta' as const,
        index: 0,
        delta: { type: 'unknown_delta' },
      } as unknown as Anthropic.MessageStreamEvent;

      const result = AnthropicResponseParser.parseStreamingChunk(chunk);
      expect(result).toBeNull();
    });

    it('should return null and log error on exception', () => {
      // Force an error by making the chunk cause an exception
      const chunk = {
        type: 'content_block_start',
        get content_block() {
          throw new Error('forced error');
        },
      } as unknown as Anthropic.MessageStreamEvent;

      const result = AnthropicResponseParser.parseStreamingChunk(chunk);
      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle content_block_start tool_use with empty name', () => {
      const chunk = {
        type: 'content_block_start' as const,
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tool_2',
          name: '',
          input: {},
        },
      } as Anthropic.MessageStreamEvent;

      const result = AnthropicResponseParser.parseStreamingChunk(chunk);

      expect(result).not.toBeNull();
      expect((result as IAssistantMessage).toolCalls![0].function.name).toBe('');
    });

    it('should handle text_delta with empty text', () => {
      const chunk = {
        type: 'content_block_delta' as const,
        index: 0,
        delta: { type: 'text_delta', text: '' },
      } as Anthropic.MessageStreamEvent;

      const result = AnthropicResponseParser.parseStreamingChunk(chunk);
      expect(result).not.toBeNull();
      expect(result!.content).toBe('');
    });
  });
});
