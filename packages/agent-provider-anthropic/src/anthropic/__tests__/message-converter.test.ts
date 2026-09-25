import { describe, expect, it } from 'vitest';
import type { TUniversalMessage } from '@robota-sdk/agent-core';
import { convertToAnthropicFormat, toAnthropicToolChoice } from '../message-converter';

describe('convertToAnthropicFormat', () => {
  it('converts plain text user message', () => {
    const messages: TUniversalMessage[] = [
      {
        id: 'msg-1',
        state: 'complete',
        role: 'user',
        content: 'hello',
        timestamp: new Date(),
      },
    ];
    const result = convertToAnthropicFormat(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: 'user', content: 'hello' });
  });

  it('converts user message with inline image part', () => {
    const messages: TUniversalMessage[] = [
      {
        id: 'msg-1',
        state: 'complete',
        role: 'user',
        content: 'describe this image',
        parts: [
          { type: 'text', text: 'describe this image' },
          { type: 'image_inline', mimeType: 'image/png', data: 'base64abc' },
        ],
        timestamp: new Date(),
      },
    ];
    const result = convertToAnthropicFormat(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    const content = result[0].content as Array<{ type: string }>;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: 'text', text: 'describe this image' });
    expect(content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'base64abc' },
    });
  });

  it('converts user message with URI image part', () => {
    const messages: TUniversalMessage[] = [
      {
        id: 'msg-1',
        state: 'complete',
        role: 'user',
        content: '',
        parts: [{ type: 'image_uri', uri: 'https://example.com/img.jpg' }],
        timestamp: new Date(),
      },
    ];
    const result = convertToAnthropicFormat(messages);
    const content = result[0].content as Array<{ type: string }>;
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://example.com/img.jpg' },
    });
  });

  it('falls back to content string when parts is empty', () => {
    const messages: TUniversalMessage[] = [
      {
        id: 'msg-1',
        state: 'complete',
        role: 'user',
        content: 'no parts',
        parts: [],
        timestamp: new Date(),
      },
    ];
    const result = convertToAnthropicFormat(messages);
    expect(result[0].content).toBe('no parts');
  });

  // Issue #2875 (follow-up to #2078): agent-core already isolated a malformed tool call as its own
  // failed batch result — but the NEXT round's assistant message still carries that call's raw,
  // malformed `function.arguments`, and this converter used to feed it straight to `JSON.parse`
  // with no try/catch. A truncated stream (max_tokens cutting off a tool_use mid-JSON) makes this a
  // real Anthropic failure mode, not just a hypothetical: `input` must be a JSON object even for a
  // call whose original arguments never decoded to one.
  describe('malformed tool-call arguments (#2875)', () => {
    function assistantWithToolCall(args: string): TUniversalMessage {
      return {
        id: 'msg-1',
        state: 'complete',
        role: 'assistant',
        content: null,
        timestamp: new Date(),
        toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'search', arguments: args } }],
      };
    }

    it('does not throw on invalid JSON, and sends an empty object input', () => {
      const messages = [assistantWithToolCall('not json')];

      let result: ReturnType<typeof convertToAnthropicFormat> | undefined;
      expect(() => {
        result = convertToAnthropicFormat(messages);
      }).not.toThrow();

      const content = result?.[0]?.content as Array<{ type: string; input?: unknown }>;
      const toolUse = content.find((block) => block.type === 'tool_use');
      expect(toolUse?.input).toEqual({});
    });

    it('does not send an array as input when the JSON root is an array', () => {
      const messages = [assistantWithToolCall('[1]')];

      const result = convertToAnthropicFormat(messages);

      const content = result[0]?.content as Array<{ type: string; input?: unknown }>;
      const toolUse = content.find((block) => block.type === 'tool_use');
      // The Anthropic API requires `input` to be an object; an array root must not pass through.
      expect(Array.isArray(toolUse?.input)).toBe(false);
      expect(toolUse?.input).toEqual({});
    });

    it('still decodes well-formed arguments normally', () => {
      const messages = [assistantWithToolCall('{"q":"x"}')];

      const result = convertToAnthropicFormat(messages);

      const content = result[0]?.content as Array<{ type: string; input?: unknown }>;
      const toolUse = content.find((block) => block.type === 'tool_use');
      expect(toolUse?.input).toEqual({ q: 'x' });
    });

    // This is the scenario the MUST finding described: agent-core already reported the batch as
    // isolated per-call results (a decode-error tool message for the malformed call, a real result
    // for the valid one) and the round continues — so the SECOND provider request has to build from
    // an assistant message that still carries the original malformed `function.arguments` alongside
    // both tool result messages. Building that request must not throw.
    it('builds a full second-round request without throwing, mixing a malformed and a valid call', () => {
      const messages: TUniversalMessage[] = [
        {
          id: 'msg-1',
          state: 'complete',
          role: 'user',
          content: 'search for x',
          timestamp: new Date(),
        },
        {
          id: 'msg-2',
          state: 'complete',
          role: 'assistant',
          content: null,
          timestamp: new Date(),
          toolCalls: [
            { id: 'call_bad', type: 'function', function: { name: 'search', arguments: '[1]' } },
            {
              id: 'call_good',
              type: 'function',
              function: { name: 'search', arguments: '{"q":"x"}' },
            },
          ],
        },
        {
          id: 'msg-3',
          state: 'complete',
          role: 'tool',
          content:
            'Error: Failed to parse arguments for tool "search" (call call_bad): expected a JSON object at the root, got an array',
          toolCallId: 'call_bad',
          name: 'search',
          timestamp: new Date(),
        },
        {
          id: 'msg-4',
          state: 'complete',
          role: 'tool',
          content: '{"echoed":"x"}',
          toolCallId: 'call_good',
          name: 'search',
          timestamp: new Date(),
        },
      ];

      let result: ReturnType<typeof convertToAnthropicFormat> | undefined;
      expect(() => {
        result = convertToAnthropicFormat(messages);
      }).not.toThrow();

      expect(result).toHaveLength(4);
      const assistantContent = result?.[1]?.content as Array<{
        type: string;
        id?: string;
        input?: unknown;
      }>;
      const toolUses = assistantContent.filter((block) => block.type === 'tool_use');
      expect(toolUses).toHaveLength(2);
      expect(toolUses.find((block) => block.id === 'call_bad')?.input).toEqual({});
      expect(toolUses.find((block) => block.id === 'call_good')?.input).toEqual({ q: 'x' });
    });
  });
});

describe('toAnthropicToolChoice (CORE-017)', () => {
  it('maps auto/none to the typed Anthropic shapes', () => {
    expect(toAnthropicToolChoice('auto')).toEqual({ type: 'auto' });
    expect(toAnthropicToolChoice('none')).toEqual({ type: 'none' });
  });

  it("maps 'required' to Anthropic's { type: 'any' }", () => {
    expect(toAnthropicToolChoice('required')).toEqual({ type: 'any' });
  });

  it('maps a named directive to { type: tool, name }', () => {
    expect(toAnthropicToolChoice({ tool: 'get_weather' })).toEqual({
      type: 'tool',
      name: 'get_weather',
    });
  });
});
