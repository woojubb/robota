/**
 * SEC-004 — `js/double-escaping` regression floor for `WebFetch`'s HTML-to-text conversion.
 *
 * The decoder used to be a CHAIN of `.replace()` calls with `&amp;` first, so each pass re-scanned
 * the previous pass's output: `&amp;lt;` became `&lt;` and then `<`. A page that deliberately
 * encoded markup for DISPLAY therefore came back out of a tag-STRIPPING converter as markup, which
 * is the opposite of what the converter promises. These cases pin the decoder as a single pass:
 * every entity is decoded exactly once, so decoding is the inverse of encoding for every input and
 * not just for singly-encoded ones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IToolInvocationResult } from '../types/tool-result.js';

/** Encode text the way a page must in order to DISPLAY it verbatim (`&` first — correct for encoding). */
function encodeForDisplay(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

describe('SEC-004 — WebFetch HTML entity decoding is single-pass', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  async function fetchHtml(html: string): Promise<IToolInvocationResult> {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/html; charset=utf-8' },
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(html).buffer),
    } as unknown as Response);
    const { webFetchTool } = await import('../builtins/web-fetch-tool.js');
    const result = await webFetchTool.execute({ url: 'https://example.com/' } as Parameters<
      typeof webFetchTool.execute
    >[0]);
    const raw =
      typeof result === 'object' && result !== null && 'data' in result
        ? String((result as { data: unknown }).data)
        : String(result);
    return JSON.parse(raw) as IToolInvocationResult;
  }

  it('does not decode a doubly-encoded entity twice', async () => {
    // The page DISPLAYS the four characters `&lt;`; it must not come back as `<`.
    expect((await fetchHtml('<p>&amp;lt;</p>')).output).toBe('&lt;');
    expect((await fetchHtml('<p>&amp;gt;</p>')).output).toBe('&gt;');
    expect((await fetchHtml('<p>&amp;quot;</p>')).output).toBe('&quot;');
    expect((await fetchHtml('<p>&amp;#39;</p>')).output).toBe('&#39;');
    expect((await fetchHtml('<p>&amp;amp;</p>')).output).toBe('&amp;');
  });

  it('does not resurrect markup a page escaped twice for display', async () => {
    const page = '<p>&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;</p>';
    const output = (await fetchHtml(page)).output;

    expect(output).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(output).not.toContain('<script>');
  });

  it('is the inverse of the display encoder for text that already contains entity syntax', async () => {
    const displayed = 'a &lt; b && c &amp; d "e" \'f\'';
    const output = (await fetchHtml(`<p>${encodeForDisplay(displayed)}</p>`)).output;

    expect(output).toBe(displayed);
  });

  it('still decodes singly-encoded entities exactly as before', async () => {
    expect((await fetchHtml('<p>a &lt;b&gt; c</p>')).output).toBe('a <b> c');
    expect((await fetchHtml('<p>Hi &amp; bye</p>')).output).toBe('Hi & bye');
    expect((await fetchHtml('<p>&quot;q&quot; &#39;s&#39;</p>')).output).toBe('"q" \'s\'');
    expect((await fetchHtml('<p>a&nbsp;b</p>')).output).toBe('a b');
  });

  it('leaves an entity it does not decode untouched rather than half-decoding it', async () => {
    expect((await fetchHtml('<p>&copy; &#169; &ampx;</p>')).output).toBe('&copy; &#169; &ampx;');
  });
});
