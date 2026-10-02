import { describe, expect, it } from 'vitest';
import type { IToolMessage } from '@robota-sdk/agent-core';
import { convertToOpenAIResponsesInput } from '../responses-converter';
import { withToolProvenance } from '@robota-sdk/agent-core';

describe('mixed function observations', () => {
  it('transmits the registered source with the same call identity and observations', () => {
    const observation = withToolProvenance(
      { success: true, data: { saved: true }, parts: [{ type: 'text', text: 'saved' }] },
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
      content: '{"saved":true}',
      parts: observation.parts,
    };
    expect(convertToOpenAIResponsesInput([message])).toMatchObject([
      {
        call_id: 'call-source',
        output: [
          { type: 'input_text', text: '{"saved":true}' },
          { type: 'input_text', text: expect.stringContaining('fixture-plugin') },
          { type: 'input_text', text: 'saved' },
        ],
      },
    ]);
  });
  it('sends structured data, text and images as native function output content', () => {
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
        { type: 'image_uri', uri: 'https://example.test/image.png' },
      ],
    };
    expect(convertToOpenAIResponsesInput([message])).toEqual([
      {
        type: 'function_call_output',
        call_id: 'call',
        output: [
          { type: 'input_text', text: '{"revision":1}' },
          { type: 'input_text', text: 'Screenshot description' },
          { type: 'input_image', image_url: 'data:image/png;base64,image-bytes' },
          { type: 'input_image', image_url: 'https://example.test/image.png' },
        ],
      },
    ]);
  });
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
  const payload = convertToOpenAIResponsesInput([message]);
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
