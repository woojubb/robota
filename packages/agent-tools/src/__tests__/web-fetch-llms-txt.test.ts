/**
 * WebFetch points to a site's llms.txt index after an HTML page, without inlining it, and the
 * advisory probe never changes or fails the main fetch.
 */

import { describe, expect, it, vi } from 'vitest';

import { createWebFetchTool } from '../builtins/web-fetch-tool.js';

import type { IWebFetchToolOptions } from '../builtins/web-fetch-tool.js';
import type { IToolExecutionContext } from '@robota-sdk/agent-core';
import type { IToolInvocationResult } from '../types/tool-result.js';

const PAGE = 'https://docs.example.com/guide/start';
const INDEX = 'https://docs.example.com/llms.txt';
const HTML = '<html><body><h1>Start</h1><p>Install the SDK.</p></body></html>';
const VALID_INDEX = '\n# Example Docs\n\n> Docs for Example.\n\n- [Start](https://docs.example.com/guide/start.md)\n';

type TRoute = (init?: RequestInit) => Response | Promise<Response>;

function html(body = HTML): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function text(body: string, contentType = 'text/plain; charset=utf-8', status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

function harness(routes: Record<string, TRoute>, options: Omit<IWebFetchToolOptions, 'egress'> = {}, lookup = async () => ['93.184.216.34']) {
  const requested: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requested.push(url);
    const route = routes[url];
    if (!route) throw new Error(`unexpected request ${url}`);
    return route(init);
  }) as unknown as typeof globalThis.fetch;
  const tool = createWebFetchTool({ ...options, egress: { deps: { fetch, lookup } } });
  async function call(url: string, signal?: AbortSignal): Promise<IToolInvocationResult> {
    const context = signal === undefined ? undefined : ({ signal } as IToolExecutionContext);
    const result = await tool.execute({ url } as Parameters<typeof tool.execute>[0], context);
    const raw = typeof result === 'object' && result !== null && 'data' in result ? String((result as { data: unknown }).data) : String(result);
    return JSON.parse(raw) as IToolInvocationResult;
  }
  return { call, requested, tool };
}

/** A probe response that never arrives: it settles only when the request's signal aborts. */
function hangUntilAborted(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
}

const pointer = `This site publishes an LLM index at ${INDEX} (llms.txt); fetch it for a curated map of the docs.`;

describe('WebFetch llms.txt pointer', () => {
  it('points to a valid index after an HTML page without inlining it', async () => {
    const { call } = harness({ [PAGE]: () => html(), [INDEX]: () => text(VALID_INDEX, 'text/markdown') });

    const result = await call(PAGE);

    expect(result.success).toBe(true);
    expect(result.output).toBe(`Start Install the SDK.\n\n${pointer}`);
    expect(result.output).not.toContain('Docs for Example');
  });

  it.each([
    ['a 404', () => text('missing', 'text/plain', 404)],
    ['an HTML soft 404 served with 200', () => html('<html><body># Not really an index</body></html>')],
    ['an HTML body that happens to start with an H1 line', () => html('# Docs\n<html><body>shell</body></html>')],
    ['a plain-text body without an H1 first line', () => text('User-agent: *\n# comment\n')],
  ])('adds no pointer for %s', async (_label, indexRoute) => {
    const { call } = harness({ [PAGE]: () => html(), [INDEX]: indexRoute });

    const result = await call(PAGE);

    expect(result).toEqual({ success: true, output: 'Start Install the SDK.' });
  });

  it.each([
    ['a hit', () => text(VALID_INDEX)],
    ['a miss', () => text('nope', 'text/plain', 404)],
  ])('probes each origin once per tool instance after %s', async (_label, indexRoute) => {
    const other = 'https://docs.example.com/guide/next';
    const { call, requested } = harness({ [PAGE]: () => html(), [other]: () => html(), [INDEX]: indexRoute });

    const first = await call(PAGE);
    const second = await call(other);

    expect(requested.filter((url) => url === INDEX)).toHaveLength(1);
    expect(second.output.endsWith(pointer)).toBe(first.output.endsWith(pointer));
  });

  it.each([
    ['a network error', () => Promise.reject(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))],
    ['a timeout', () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))],
  ])('leaves the page result unchanged when the probe fails with %s', async (_label, indexRoute) => {
    const { call, requested } = harness({ [PAGE]: () => html(), [INDEX]: indexRoute });

    const result = await call(PAGE);

    expect(requested).toEqual([PAGE, INDEX]);
    expect(result).toEqual({ success: true, output: 'Start Install the SDK.' });
  });

  it('cuts a slow probe off at its deadline and returns the page without a pointer', async () => {
    const { call, requested } = harness({ [PAGE]: () => html(), [INDEX]: (init) => hangUntilAborted(init) });

    const started = Date.now();
    const result = await call(PAGE);
    const elapsed = Date.now() - started;

    expect(requested).toEqual([PAGE, INDEX]);
    expect(result).toEqual({ success: true, output: 'Start Install the SDK.' });
    expect(elapsed).toBeGreaterThanOrEqual(1_500);
    expect(elapsed).toBeLessThan(5_000);
  }, 10_000);

  it('does not remember a probe the caller cancelled as a miss', async () => {
    const controller = new AbortController();
    let probes = 0;
    const { call } = harness({
      [PAGE]: () => html(),
      [INDEX]: (init) => {
        probes += 1;
        if (probes === 1) {
          setTimeout(() => controller.abort(), 10);
          return hangUntilAborted(init);
        }
        return text(VALID_INDEX);
      },
    });

    const cancelledAt = Date.now();
    await call(PAGE, controller.signal).catch(() => undefined);
    // The probe honours the caller's signal instead of waiting out its own deadline.
    expect(Date.now() - cancelledAt).toBeLessThan(1_000);
    const second = await call(PAGE);

    expect(probes).toBe(2);
    expect(second.output.endsWith(pointer)).toBe(true);
  });

  it('never sends the probe to a destination the egress policy refuses', async () => {
    // The page's host resolves publicly, then to a private address when the probe resolves it again.
    let lookups = 0;
    const lookup = async () => (lookups++ === 0 ? ['93.184.216.34'] : ['10.0.0.7']);
    const { call, requested } = harness({ [PAGE]: () => html(), [INDEX]: () => text(VALID_INDEX) }, {}, lookup);

    const result = await call(PAGE);

    expect(result).toEqual({ success: true, output: 'Start Install the SDK.' });
    // The probe resolved the host through the egress policy, which refused it before any request.
    expect(lookups).toBe(2);
    expect(requested).toEqual([PAGE]);
  });

  it('returns a fetched llms.txt unchanged and does not probe for non-HTML bodies', async () => {
    const { call, requested } = harness({ [INDEX]: () => text(VALID_INDEX, 'text/markdown') });

    const result = await call(INDEX);

    expect(result).toEqual({ success: true, output: VALID_INDEX });
    expect(requested).toEqual([INDEX]);
  });

  it('does not probe, or promise a pointer, when the host turns the probe off', async () => {
    const { call, requested, tool } = harness({ [PAGE]: () => html(), [INDEX]: () => text(VALID_INDEX) }, { llmsTxtProbe: false });

    const result = await call(PAGE);

    expect(result).toEqual({ success: true, output: 'Start Install the SDK.' });
    expect(requested).toEqual([PAGE]);
    expect(tool.getDescription()).toContain('/llms.txt');
    expect(tool.getDescription()).not.toMatch(/points to it/);
  });

  it('describes the pointer when the probe is on', () => {
    expect(harness({}).tool.getDescription()).toMatch(/the result points to it/);
  });
});
