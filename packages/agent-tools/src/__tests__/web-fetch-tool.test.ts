/**
 * CLI-041 TC-03: web-fetch-tool.ts — classifyFetchError and fetch behaviour tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyFetchError } from '../builtins/web-fetch-tool.js';
import type { TToolResult } from '../types/tool-result.js';

// ---------------------------------------------------------------------------
// TC-03: classifyFetchError — error classification
// ---------------------------------------------------------------------------

describe('classifyFetchError', () => {
  it('returns timeout message for AbortError', () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const msg = classifyFetchError(err);
    expect(msg).toMatch(/timed out/i);
    expect(msg).toContain('30s');
  });

  it('returns DNS error message for ENOTFOUND', () => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    const msg = classifyFetchError(err);
    expect(msg).toMatch(/DNS resolution failed/i);
  });

  it('returns DNS error message for EAI_AGAIN', () => {
    const err = Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' });
    const msg = classifyFetchError(err);
    expect(msg).toMatch(/DNS resolution failed/i);
  });

  it('returns connection refused message for ECONNREFUSED', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const msg = classifyFetchError(err);
    expect(msg).toMatch(/Connection refused/i);
  });

  it('returns connection reset message for ECONNRESET', () => {
    const err = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const msg = classifyFetchError(err);
    expect(msg).toMatch(/Connection was reset/i);
  });

  it('returns connection timeout message for ETIMEDOUT', () => {
    const err = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const msg = classifyFetchError(err);
    expect(msg).toMatch(/Connection timed out/i);
  });

  it('returns SSL error message for CERT_HAS_EXPIRED', () => {
    const err = Object.assign(new Error('certificate has expired'), {
      code: 'CERT_HAS_EXPIRED',
    });
    const msg = classifyFetchError(err);
    expect(msg).toMatch(/SSL certificate error/i);
  });

  it('returns SSL error message for UNABLE_TO_VERIFY_LEAF_SIGNATURE', () => {
    const err = Object.assign(new Error('unable to verify'), {
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    });
    const msg = classifyFetchError(err);
    expect(msg).toMatch(/SSL certificate error/i);
  });

  it('returns generic network error for unknown error code', () => {
    const err = Object.assign(new Error('something broke'), { code: 'EUNKNOWN' });
    const msg = classifyFetchError(err);
    expect(msg).toContain('something broke');
  });

  it('converts non-Error value to string', () => {
    const msg = classifyFetchError('raw string error');
    expect(msg).toBe('raw string error');
  });
});

// ---------------------------------------------------------------------------
// webFetchTool integration — mocked fetch
// ---------------------------------------------------------------------------

describe('webFetchTool — fetch behaviour', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  async function callWebFetch(url: string, headers?: Record<string, string>): Promise<TToolResult> {
    const { webFetchTool } = await import('../builtins/web-fetch-tool.js');
    const args: Record<string, unknown> = { url };
    if (headers !== undefined) args['headers'] = headers;
    const result = await webFetchTool.execute(args as Parameters<typeof webFetchTool.execute>[0]);
    const raw =
      typeof result === 'object' && result !== null && 'data' in result
        ? String((result as { data: unknown }).data)
        : String(result);
    return JSON.parse(raw) as TToolResult;
  }

  it('returns success result for a 200 response with plain text', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      arrayBuffer: () => Promise.resolve(Buffer.from('hello world').buffer),
    } as unknown as Response);

    const result = await callWebFetch('https://example.com/text');
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello world');
  });

  it('returns success result and strips HTML tags for text/html response', async () => {
    const html = '<html><body><h1>Title</h1><p>Content</p></body></html>';
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/html; charset=utf-8' },
      arrayBuffer: () => Promise.resolve(Buffer.from(html).buffer),
    } as unknown as Response);

    const result = await callWebFetch('https://example.com/');
    expect(result.success).toBe(true);
    expect(result.output).not.toContain('<h1>');
    expect(result.output).toContain('Title');
  });

  it('returns failure result for HTTP 404 response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: () => 'text/plain' },
    } as unknown as Response);

    const result = await callWebFetch('https://example.com/missing');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/404/);
    expect(result.error).toMatch(/Do not retry/i);
  });

  it('returns failure result for HTTP 500 response with retry hint', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: () => 'text/plain' },
    } as unknown as Response);

    const result = await callWebFetch('https://example.com/error');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/500/);
    expect(result.error).toMatch(/retrying may help/i);
  });

  it('returns failure result for invalid URL without calling fetch', async () => {
    const result = await callWebFetch('not-a-url');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid URL/i);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('returns failure result when fetch throws a network error', async () => {
    const networkErr = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(networkErr);

    const result = await callWebFetch('https://nonexistent.invalid/');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/DNS resolution failed/i);
  });

  it('returns failure result when fetch times out (AbortError)', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(abortErr);

    const result = await callWebFetch('https://slow.example.com/');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out/i);
  });
});
