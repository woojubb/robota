/**
 * NEUT-008 — web-search provider port: the tool layer composes over a duck-typed
 * search-provider port; vendor coupling (endpoint, signup URL) stays out of the tool layer.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { IToolInvocationResult } from '../types/tool-result.js';
import type { FunctionTool } from '@robota-sdk/agent-core';

/**
 * The default adapter's vendor host. Every vendor URL — endpoint, signup page, docs, any subdomain,
 * any scheme — contains it, so one substring probe covers the whole family the neutrality rule bans.
 */
const VENDOR_HOST = 'brave.com';

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
    vi.unstubAllEnvs();
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
    //
    // SEC-004 (`js/regex/missing-regexp-anchor`): these were unanchored hostname REGEXES spelling
    // out two exact endpoints. A substring search is what is wanted here — the literal may sit
    // anywhere in the file — so it is written as a substring search, and the property asserted is
    // the one the test name claims: no vendor host in ANY spelling, not two hand-picked ones.
    const toolSource = readFileSync(
      fileURLToPath(new URL('../builtins/web-search-tool.ts', import.meta.url)),
      'utf8',
    );
    expect(toolSource).not.toContain(VENDOR_HOST);
    expect(toolSource).not.toMatch(/https?:\/\//);
  });

  it('default missing-key error names the env var but carries no vendor signup URL', async () => {
    vi.stubEnv('BRAVE_API_KEY', undefined);
    const { webSearchTool } = await import('../builtins/web-search-tool.js');

    const result = await callTool(webSearchTool, 'anything');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/BRAVE_API_KEY/);
    // SEC-004: was `not.toMatch(/https:\/\/brave\.com/)`, which rejected exactly one spelling —
    // the vendor's real key-signup URL (`https://api.search.brave.com/app/keys`) sailed through the
    // check that exists to keep it out. Reject the host in any form, and any URL at all.
    expect(result.error).not.toContain(VENDOR_HOST);
    expect(result.error).not.toMatch(/https?:\/\//);
  });
});
