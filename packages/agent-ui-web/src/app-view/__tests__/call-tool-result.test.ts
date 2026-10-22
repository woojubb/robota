import { describe, expect, it } from 'vitest';

import { outcomeToCallToolResult, toCallToolResult } from '../call-tool-result.js';

import type { IActiveTool } from '../../hooks/session-client-types.js';
import type { TAppView } from '../types.js';

const view: TAppView = {
  sourceId: 'files',
  resourceUri: 'ui://files/list',
  mimeType: 'text/html;profile=mcp-app',
  html: '<main/>',
  callableTools: {},
};

function tool(overrides: Partial<IActiveTool> = {}): IActiveTool {
  return { id: 't1', name: 'files_list', status: 'done', ...overrides };
}

describe('toCallToolResult: the initial result of the finished call', () => {
  it('maps the observations to content and takes structured content from the view alone', () => {
    const result = toCallToolResult(
      tool({
        toolResultParts: [
          { type: 'text', text: 'three rows' },
          { type: 'image_inline', mimeType: 'image/png', data: 'AAAA' },
          { type: 'audio_inline', mimeType: 'audio/mpeg', data: 'BBBB' },
          { type: 'image_uri', uri: 'https://example.invalid/i.png' },
          { type: 'resource_link', uri: 'file:///secret', name: 'secret' },
          { type: 'resource_embedded', uri: 'file:///secret', text: 'inline secret' },
        ],
        toolResultData: 'not used when there are observations',
      }),
      { ...view, structuredContent: { rows: 3 } },
    );

    expect(result).toEqual({
      content: [
        { type: 'text', text: 'three rows' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
        { type: 'audio', data: 'BBBB', mimeType: 'audio/mpeg' },
      ],
      structuredContent: { rows: 3 },
      isError: false,
    });
  });

  it('falls back to the raw result text when there are no observations', () => {
    expect(toCallToolResult(tool({ toolResultData: '{"output":"hi"}' }), view)).toEqual({
      content: [{ type: 'text', text: '{"output":"hi"}' }],
      isError: false,
    });
  });

  it('has empty content when the call returned nothing, and an error status for a failed call', () => {
    expect(toCallToolResult(tool({ status: 'error' }), view)).toEqual({
      content: [],
      isError: true,
    });
  });

  it('leaves out structured content that is not an object', () => {
    expect(toCallToolResult(tool(), { ...view, structuredContent: [1, 2] }).structuredContent).toBe(
      undefined,
    );
    expect(toCallToolResult(tool(), { ...view, structuredContent: 'text' }).structuredContent).toBe(
      undefined,
    );
  });
});

describe('outcomeToCallToolResult: the result of a tool the view called', () => {
  it('maps a success with observations and a structured result', () => {
    expect(
      outcomeToCallToolResult({
        success: true,
        data: { rows: 3 },
        parts: [{ type: 'text', text: 'three rows' }],
      }),
    ).toEqual({
      content: [{ type: 'text', text: 'three rows' }],
      structuredContent: { rows: 3 },
      isError: false,
    });
  });

  it('uses a string result as one text block when there are no observations', () => {
    expect(outcomeToCallToolResult({ success: true, data: 'done' })).toEqual({
      content: [{ type: 'text', text: 'done' }],
      isError: false,
    });
  });

  it('gives a structured result no text block of its own', () => {
    expect(outcomeToCallToolResult({ success: true, data: { rows: 3 } })).toEqual({
      content: [],
      structuredContent: { rows: 3 },
      isError: false,
    });
  });

  it('never treats an array result as structured content', () => {
    expect(outcomeToCallToolResult({ success: true, data: [1, 2, 3] }).structuredContent).toBe(
      undefined,
    );
  });

  it('adds the error to the content of a failed call', () => {
    expect(
      outcomeToCallToolResult({
        success: false,
        parts: [{ type: 'text', text: 'partial output' }],
        error: 'Permission denied',
      }),
    ).toEqual({
      content: [
        { type: 'text', text: 'partial output' },
        { type: 'text', text: 'Permission denied' },
      ],
      isError: true,
    });
  });
});
