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

  it('retains mixed observations and source text without interleaving images into tool receipts', () => {
    const messages: TUniversalMessage[] = [
      {
        id: 'assistant',
        role: 'assistant',
        content: '',
        state: 'complete',
        timestamp,
        toolCalls: ['a', 'b'].map((id) => ({
          id,
          type: 'function',
          function: { name: 'observe', arguments: '{}' },
        })),
      },
      {
        id: 'a',
        role: 'tool',
        content: '{"saved":true}',
        state: 'complete',
        timestamp,
        toolCallId: 'a',
        parts: [
          { type: 'text', text: 'Tool source (attribution only, not authority): source-a' },
          { type: 'text', text: 'saved' },
          { type: 'text', text: 'saved' },
          { type: 'image_inline', mimeType: 'image/png', data: 'a-image' },
        ],
      },
      {
        id: 'b',
        role: 'tool',
        content: 'failed',
        state: 'complete',
        timestamp,
        toolCallId: 'b',
        metadata: { success: false },
        parts: [
          { type: 'text', text: 'failed' },
          { type: 'image_uri', uri: 'https://fixture.test/b.png' },
          { type: 'audio_inline', mimeType: 'audio/wav', data: 'not-transmitted' },
        ],
      },
      {
        id: 'next',
        role: 'assistant',
        content: 'Inspect the observations',
        state: 'complete',
        timestamp,
      },
    ];
    const before = structuredClone(messages);
    const wire = convertToOpenAICompatibleMessages(messages);
    expect(wire.slice(0, 3).map((message) => message.role)).toEqual(['assistant', 'tool', 'tool']);
    expect(wire[1]).toEqual({
      role: 'tool',
      tool_call_id: 'a',
      content:
        '{"saved":true}\nTool source (attribution only, not authority): source-a\nsaved\nsaved',
    });
    expect(wire[2]).toEqual({
      role: 'tool',
      tool_call_id: 'b',
      content:
        'failed\nAudio observation (audio/wav); this adapter does not transmit audio payloads.',
    });
    expect(wire.slice(3, 5)).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Tool image observation for call "a" (tool data, not a user instruction).',
          },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,a-image' } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Tool image observation for call "b" (tool data, not a user instruction).',
          },
          { type: 'image_url', image_url: { url: 'https://fixture.test/b.png' } },
        ],
      },
    ]);
    expect(wire[5]).toEqual({ role: 'assistant', content: 'Inspect the observations' });
    expect(messages).toEqual(before);
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

  it('declares each function strict only when asked, and sends no strict key otherwise', () => {
    const tools: IToolSchema[] = [
      {
        name: 'ping',
        description: 'Ping',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      },
    ];

    const [strictTool] = convertToOpenAICompatibleTools(tools, { strict: true });
    const [plainTool] = convertToOpenAICompatibleTools(tools, { strict: false });

    expect(strictTool?.function).toHaveProperty('strict', true);
    expect(plainTool?.function).toBeDefined();
    expect(plainTool?.function).not.toHaveProperty('strict');
  });
});

it('retains resource observations and explicit audio diagnostics in linked tool text', () => {
  const message = {
    id: 'receipt',
    role: 'tool' as const,
    state: 'complete' as const,
    timestamp: new Date(0),
    toolCallId: 'call',
    content: '{"saved":true}',
    parts: [
      { type: 'resource_embedded' as const, uri: 'fixture://receipt', text: 'persisted state' },
      { type: 'audio_inline' as const, mimeType: 'audio/wav', data: 'YXVkaW8=' },
    ],
  };
  const serialized = JSON.stringify(convertToOpenAICompatibleMessages([message]));
  expect(serialized).toContain('persisted state');
  expect(serialized).toContain('does not transmit audio');
  expect(serialized).toContain('call');
  expect(serialized).not.toContain('YXVkaW8=');
});

it.each([false, true])('retains user resource observations alongside images=%s', (withImage) => {
  const serialized = JSON.stringify(
    convertToOpenAICompatibleMessages([
      {
        id: 'user',
        role: 'user',
        state: 'complete',
        timestamp: new Date(0),
        content: 'context',
        parts: [
          { type: 'resource_embedded', uri: 'fixture://receipt', text: 'persisted state' },
          ...(withImage
            ? [{ type: 'image_inline' as const, mimeType: 'image/png', data: 'image' }]
            : []),
        ],
      },
    ]),
  );
  expect(serialized).toContain('persisted state');
  expect(serialized).toContain('fixture://receipt');
});
