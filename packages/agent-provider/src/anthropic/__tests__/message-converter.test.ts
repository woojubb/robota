import { describe, expect, it } from 'vitest';
import type { TUniversalMessage } from '@robota-sdk/agent-core';
import { convertToAnthropicFormat } from '../message-converter';

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
});
