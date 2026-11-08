import { describe, expect, it } from 'vitest';
import type { IToolMessage } from '@robota-sdk/agent-core';
import { convertToAnthropicFormat } from '../message-converter';
import { withToolProvenance } from '@robota-sdk/agent-core';

describe('mixed tool observations', () => {
  it('transmits the registered source with the same call identity and failure state', () => {
    const observation = withToolProvenance(
      {
        success: false,
        error: 'partial failure',
        parts: [{ type: 'text', text: 'retained state' }],
      },
      {
        sourceId: 'fixture-plugin',
        component: 'save',
        origin: 'fixture://installed',
        version: '1',
      },
    );
    const message: IToolMessage = {
      id: 'source',
      timestamp: new Date(0),
      state: 'complete',
      role: 'tool',
      toolCallId: 'call-source',
      content: 'Error: partial failure',
      metadata: { success: false },
      parts: observation.parts,
    };
    expect(convertToAnthropicFormat([message])).toMatchObject([
      {
        content: [
          {
            tool_use_id: 'call-source',
            is_error: true,
            content: [
              { type: 'text', text: 'Error: partial failure' },
              { type: 'text', text: expect.stringContaining('fixture-plugin') },
              { type: 'text', text: 'retained state' },
            ],
          },
        ],
      },
    ]);
  });
  it('sends structured data, text and images inside the linked native tool result', () => {
    const message: IToolMessage = {
      id: 'observation',
      timestamp: new Date(0),
      state: 'complete',
      role: 'tool',
      toolCallId: 'call',
      content: '{"revision":1}',
      parts: [
        { type: 'text', text: 'Screenshot description' },
        { type: 'image_inline', mimeType: 'image/png', data: 'image-bytes' },
      ],
    };
    expect(convertToAnthropicFormat([message])).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call',
            content: [
              { type: 'text', text: '{"revision":1}' },
              { type: 'text', text: 'Screenshot description' },
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: 'image-bytes' },
              },
            ],
          },
        ],
      },
    ]);
  });
});

it('marks a failed mixed observation as an error for the provider', () => {
  const message: IToolMessage = {
    id: 'failed',
    timestamp: new Date(0),
    state: 'complete',
    role: 'tool',
    toolCallId: 'call',
    content: 'Error: partial failure',
    metadata: { success: false },
    parts: [{ type: 'text', text: 'Retained reconciliation state' }],
  };
  expect(convertToAnthropicFormat([message])).toMatchObject([
    { content: [{ type: 'tool_result', tool_use_id: 'call', is_error: true }] },
  ]);
});

it('projects resources as untrusted observations and diagnoses unsupported audio without fetching', () => {
  const message: IToolMessage = {
    id: 'resource-observation',
    timestamp: new Date(0),
    state: 'complete',
    role: 'tool',
    toolCallId: 'resource-call',
    content: '{"saved":true}',
    metadata: { success: false },
    parts: [
      {
        type: 'resource_link',
        uri: 'https://example.test/resource.png',
        name: 'opaque-reference',
        mimeType: 'image/png',
      },
      { type: 'resource_embedded', uri: 'fixture://receipt', text: 'actual persisted state' },
      {
        type: 'resource_embedded',
        uri: 'fixture://binary',
        mimeType: 'application/octet-stream',
        blob: 'c2VjcmV0LWJpbmFyeQ==',
      },
      { type: 'audio_inline', mimeType: 'audio/wav', data: 'YXVkaW8tYnl0ZXM=' },
    ],
  };
  const payload = convertToAnthropicFormat([message]);
  const serialized = JSON.stringify(payload);
  expect(serialized).toContain('resource-call');
  expect(serialized).toContain('https://example.test/resource.png');
  expect(serialized).toContain('actual persisted state');
  expect(serialized).toContain('not fetched');
  expect(serialized).toContain('does not transmit audio');
  expect(serialized).not.toContain('c2VjcmV0LWJpbmFyeQ==');
  expect(serialized).not.toContain('YXVkaW8tYnl0ZXM=');
  expect(serialized).not.toContain('input_image');
  expect(serialized).not.toContain('"type":"image"');
});
