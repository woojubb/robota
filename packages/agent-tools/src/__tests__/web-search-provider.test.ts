/**
 * NEUT-008 — web-search provider port: the tool layer composes over a duck-typed
 * search-provider port; vendor coupling (endpoint, signup URL) stays out of the tool layer.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { IToolInvocationResult } from '../types/tool-result.js';
import type { FunctionTool } from '@robota-sdk/agent-core';

async function callTool(tool: FunctionTool, query: string): Promise<IToolInvocationResult> {
  const result = await tool.execute({ query } as Parameters<typeof tool.execute>[0]);
  const raw =
    typeof result === 'object' && result !== null && 'data' in result
      ? String((result as { data: unknown }).data)
      : String(result);
  return JSON.parse(raw) as IToolInvocationResult;
}

describe('web-search provider port (NEUT-008)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('an injected custom provider is used instead of the default adapter', async () => {
    const mod = await import('../builtins/web-search-tool.js');
    const search = vi
      .fn()
      .mockResolvedValue([{ title: 'Custom', url: 'https://example.com', snippet: 'from port' }]);
    const tool = mod.createWebSearchTool({ provider: { search } });

    const result = await callTool(tool, 'port query');

    expect(result.success).toBe(true);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'port query' }),
      expect.anything(),
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    const results = JSON.parse(result.output) as Array<{ title: string }>;
    expect(results[0]?.title).toBe('Custom');
  });

  it('a provider failure surfaces as a structured error result', async () => {
    const mod = await import('../builtins/web-search-tool.js');
    const tool = mod.createWebSearchTool({
      provider: { search: () => Promise.reject(new Error('provider exploded')) },
    });

    const result = await callTool(tool, 'boom');

    expect(result.success).toBe(false);
    expect(result.error).toContain('provider exploded');
  });

  it('the tool-layer source holds no vendor endpoint or signup-URL literal', () => {
    // The default adapter module may hold the endpoint; the TOOL layer must not carry any
    // vendor URL literal (NEUT-008). Importing the default adapter by name is the sanctioned
    // "default provider wired via factory option" seam.
    const toolSource = readFileSync(
      fileURLToPath(new URL('../builtins/web-search-tool.ts', import.meta.url)),
      'utf8',
    );
    expect(toolSource).not.toMatch(/api\.search\.brave\.com/);
    expect(toolSource).not.toMatch(/brave\.com\/search/);
    expect(toolSource).not.toMatch(/https?:\/\//);
  });

  it('default missing-key error names the env var but carries no vendor signup URL', async () => {
    delete process.env['BRAVE_API_KEY'];
    const { webSearchTool } = await import('../builtins/web-search-tool.js');

    const result = await callTool(webSearchTool, 'anything');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/BRAVE_API_KEY/);
    expect(result.error).not.toMatch(/https:\/\/brave\.com/);
  });
});
