import { describe, expect, it } from 'vitest';
import type { IToolSchema, TUniversalMessage } from '@robota-sdk/agent-core';
import { convertToOpenAICompatibleMessages, convertToOpenAICompatibleTools } from './index';

const timestamp = new Date('2026-05-01T00:00:00.000Z');

describe('OpenAI-compatible message converter', () => {
  it('converts universal chat messages to Chat Completions messages', () => {
    const messages: TUniversalMessage[] = [
      {
        id: 'system-1',
        role: 'system',
        content: 'You are concise.',
        state: 'complete',
        timestamp,
      },
      {
        id: 'user-1',
        role: 'user',
        content: 'Search docs',
        state: 'complete',
        timestamp,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        state: 'complete',
        timestamp,
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"docs"}' },
          },
        ],
      },
      {
        id: 'tool-1',
        role: 'tool',
        content: 'result',
        state: 'complete',
        timestamp,
        toolCallId: 'call-1',
      },
    ];

    expect(convertToOpenAICompatibleMessages(messages)).toEqual([
      { role: 'system', content: 'You are concise.' },
      { role: 'user', content: 'Search docs' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"docs"}' },
          },
        ],
      },
      { role: 'tool', content: 'result', tool_call_id: 'call-1' },
    ]);
  });

  it('rejects tool messages without a toolCallId', () => {
    const messages: TUniversalMessage[] = [
      {
        id: 'tool-1',
        role: 'tool',
        content: 'result',
        state: 'complete',
        timestamp,
        toolCallId: '',
      },
    ];

    expect(() => convertToOpenAICompatibleMessages(messages)).toThrow(
      'Tool message missing toolCallId',
    );
  });

  it('converts user message with inline image part to image_url content block', () => {
    const messages: TUniversalMessage[] = [
      {
        id: 'user-img',
        role: 'user',
        content: '',
        state: 'complete',
        timestamp,
        parts: [
          { type: 'text', text: 'Describe this image' },
          { type: 'image_inline', mimeType: 'image/png', data: 'abc123==' },
        ],
      },
    ];

    expect(convertToOpenAICompatibleMessages(messages)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123==' } },
        ],
      },
    ]);
  });

  it('converts user message with URI image part to image_url content block', () => {
    const messages: TUniversalMessage[] = [
      {
        id: 'user-uri',
        role: 'user',
        content: '',
        state: 'complete',
        timestamp,
        parts: [
          { type: 'text', text: 'What is this?' },
          { type: 'image_uri', uri: 'https://example.com/image.png' },
        ],
      },
    ];

    expect(convertToOpenAICompatibleMessages(messages)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
        ],
      },
    ]);
  });

  it('falls back to string content when parts contain only text', () => {
    const messages: TUniversalMessage[] = [
      {
        id: 'user-text-parts',
        role: 'user',
        content: 'hello',
        state: 'complete',
        timestamp,
        parts: [{ type: 'text', text: 'hello' }],
      },
    ];

    const result = convertToOpenAICompatibleMessages(messages);
    expect(result[0]).toEqual({ role: 'user', content: 'hello' });
  });

  it('falls back to string content when parts is empty', () => {
    const messages: TUniversalMessage[] = [
      {
        id: 'user-empty-parts',
        role: 'user',
        content: 'fallback',
        state: 'complete',
        timestamp,
        parts: [],
      },
    ];

    expect(convertToOpenAICompatibleMessages(messages)).toEqual([
      { role: 'user', content: 'fallback' },
    ]);
  });

  it('converts universal tool schemas to OpenAI-compatible function tools', () => {
    const tools: IToolSchema[] = [
      {
        name: 'read_file',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ];

    expect(convertToOpenAICompatibleTools(tools)).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      },
    ]);
  });
});
