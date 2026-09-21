import { describe, expect, it } from 'vitest';

import { buildMCPRequest, processMCPResponse } from '../mcp-protocol.js';

import type { IMCPResponse } from '../mcp-protocol.js';

describe('buildMCPRequest', () => {
  it('builds a JSON-RPC 2.0 tools/call request carrying the spec-conformant params', () => {
    const request = buildMCPRequest('echo', { text: 'hi' });
    expect(request.jsonrpc).toBe('2.0');
    expect(request.method).toBe('tools/call');
    expect(request.params).toEqual({ name: 'echo', arguments: { text: 'hi' } });
    expect(typeof request.id).toBe('string');
    expect(request.id).toContain('echo-');
  });

  it('produces a distinct id per call', () => {
    const a = buildMCPRequest('echo', {});
    const b = buildMCPRequest('echo', {});
    expect(a.id).not.toBe(b.id);
  });
});

describe('processMCPResponse', () => {
  it('joins text content parts of a successful result', () => {
    const response: IMCPResponse = {
      jsonrpc: '2.0',
      id: '1',
      result: {
        content: [
          { type: 'text', text: 'line one' },
          { type: 'image', text: 'ignored-non-text' },
          { type: 'text', text: 'line two' },
        ],
      },
    };
    expect(processMCPResponse(response)).toEqual({ success: true, content: 'line one\nline two' });
  });

  it('returns empty content when the result has no text parts', () => {
    const response: IMCPResponse = { jsonrpc: '2.0', id: '1', result: { content: [] } };
    expect(processMCPResponse(response)).toEqual({ success: true, content: '' });
  });

  it('throws on a JSON-RPC error response', () => {
    const response: IMCPResponse = {
      jsonrpc: '2.0',
      id: '1',
      error: { code: -32000, message: 'boom' },
    };
    expect(() => processMCPResponse(response)).toThrow(/-32000.*boom|boom/);
  });

  it('throws when neither result nor error is present', () => {
    const response = { jsonrpc: '2.0', id: '1' } as IMCPResponse;
    expect(() => processMCPResponse(response)).toThrow(/neither result nor error/);
  });

  it('throws on an isError result, surfacing the text detail', () => {
    const response: IMCPResponse = {
      jsonrpc: '2.0',
      id: '1',
      result: { isError: true, content: [{ type: 'text', text: 'bad input' }] },
    };
    expect(() => processMCPResponse(response)).toThrow(/bad input/);
  });
});
