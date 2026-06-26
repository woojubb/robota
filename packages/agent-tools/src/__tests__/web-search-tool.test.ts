/**
 * CLI-041 TC-04: web-search-tool.ts — API key absent and network error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IToolInvocationResult } from '../types/tool-result.js';

async function callWebSearch(query: string, limit?: number): Promise<IToolInvocationResult> {
  const { webSearchTool } = await import('../builtins/web-search-tool.js');
  const args: Record<string, unknown> = { query };
  if (limit !== undefined) args['limit'] = limit;
  const result = await webSearchTool.execute(args as Parameters<typeof webSearchTool.execute>[0]);
  const raw =
    typeof result === 'object' && result !== null && 'data' in result
      ? String((result as { data: unknown }).data)
      : String(result);
  return JSON.parse(raw) as IToolInvocationResult;
}

describe('webSearchTool', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('BRAVE_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  // TC-04: no API key → graceful error message, no crash
  it('TC-04: returns failure result when BRAVE_API_KEY is not set', async () => {
    vi.stubEnv('BRAVE_API_KEY', '');
    // delete so the check sees falsy
    delete process.env['BRAVE_API_KEY'];

    const result = await callWebSearch('typescript tutorial');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/BRAVE_API_KEY/);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  // TC-04: fetch throws → error message returned, no crash
  it('TC-04: returns failure result when fetch throws a network error', async () => {
    vi.stubEnv('BRAVE_API_KEY', 'test-brave-key');
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('Network failure'));

    const result = await callWebSearch('nodejs fetch');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Network failure');
  });

  it('returns failure result when Brave API responds with non-OK status', async () => {
    vi.stubEnv('BRAVE_API_KEY', 'test-brave-key');
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    } as unknown as Response);

    const result = await callWebSearch('rate limited query');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/429/);
  });

  it('returns success result with mapped results on valid API response', async () => {
    vi.stubEnv('BRAVE_API_KEY', 'test-brave-key');
    const mockResponse = {
      web: {
        results: [
          { title: 'Result One', url: 'https://example.com/1', description: 'First result' },
          { title: 'Result Two', url: 'https://example.com/2', description: 'Second result' },
        ],
      },
    };
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(mockResponse),
    } as unknown as Response);

    const result = await callWebSearch('test query');
    expect(result.success).toBe(true);
    const results = JSON.parse(result.output) as Array<{
      title: string;
      url: string;
      snippet: string;
    }>;
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      title: 'Result One',
      url: 'https://example.com/1',
      snippet: 'First result',
    });
  });

  it('returns success result with empty array when API returns no web results', async () => {
    vi.stubEnv('BRAVE_API_KEY', 'test-brave-key');
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({}),
    } as unknown as Response);

    const result = await callWebSearch('obscure query with no results');
    expect(result.success).toBe(true);
    const results = JSON.parse(result.output) as unknown[];
    expect(results).toHaveLength(0);
  });

  it('passes limit capped at 20 to the API query string', async () => {
    vi.stubEnv('BRAVE_API_KEY', 'test-brave-key');
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ web: { results: [] } }),
    } as unknown as Response);

    await callWebSearch('test', 50);

    const calledUrl = String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]);
    expect(calledUrl).toContain('count=20');
  });
});
