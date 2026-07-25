/**
 * SEC-003 — `js/polynomial-redos` regression floor for `agent-tools`.
 *
 * Two sites: the flagged sandbox-root normaliser (alert 47) and `WebFetch`'s HTML-to-text conversion, which
 * CodeQL did **not** flag and which is the only quadratic in this slice whose input is a live response body from
 * an arbitrary URL. Each fix ships a timing test (red for seconds against the pre-fix source) and an equivalence
 * test pinning the output.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyWorkspaceManifest } from '../index.js';

import type { ISandboxClient, ISandboxRunResult } from '../sandbox/types.js';
import type { IToolInvocationResult } from '../types/tool-result.js';

const PUMP = 200_000;
const BUDGET_MS = 250;
const RED_TIMEOUT_MS = 120_000;

/**
 * A client WITHOUT `applyManifest` — `applyWorkspaceManifest` delegates to that hook when present and would then
 * never reach `normalizeSandboxRoot`.
 */
function recordingClient(): { client: ISandboxClient; paths: string[] } {
  const paths: string[] = [];
  const ok: ISandboxRunResult = { exitCode: 0, stdout: '', stderr: '' };
  return {
    paths,
    client: {
      run: async (command: string) => {
        paths.push(command);
        return ok;
      },
      readFile: async () => '',
      writeFile: async (path: string) => {
        paths.push(path);
      },
    },
  };
}

describe('SEC-003 alert 47 — sandbox root normalisation', () => {
  it(
    'normalises a pumped separator run in linear time',
    async () => {
      const { client } = recordingClient();
      // The backslash conversion inside `normalizeSandboxRoot` manufactures the `/` run.
      const targetRoot = `/a${'\\'.repeat(PUMP)}b`;
      const started = performance.now();
      await applyWorkspaceManifest(client, { entries: {} }, { targetRoot });
      expect(performance.now() - started).toBeLessThan(BUDGET_MS);
    },
    RED_TIMEOUT_MS,
  );

  it('strips exactly the trailing separators for ordinary input', async () => {
    const { client, paths } = recordingClient();
    await applyWorkspaceManifest(
      client,
      { entries: { 'src/a.txt': { type: 'file', content: 'x' } } },
      { targetRoot: '/workspace/sub///' },
    );
    expect(paths.join('\n')).toContain('/workspace/sub/src/a.txt');
  });

  it('still converts backslashes before stripping the trailing separators', async () => {
    const { client, paths } = recordingClient();
    await applyWorkspaceManifest(
      client,
      { entries: { 'a.txt': { type: 'file', content: 'x' } } },
      { targetRoot: '\\workspace\\sub\\\\' },
    );
    expect(paths.join('\n')).toContain('/workspace/sub/a.txt');
  });

  it('rejects a target root that is not absolute after normalisation', async () => {
    const { client } = recordingClient();
    await expect(
      applyWorkspaceManifest(client, { entries: {} }, { targetRoot: 'relative/root' }),
    ).rejects.toThrow(/must be an absolute sandbox path/);
  });
});

describe('SEC-003 sweep — WebFetch HTML-to-text (unflagged, remote-sourced)', () => {
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
      // `TextEncoder`, not `Buffer.from(html).buffer` — a Buffer is a view into a shared pool, so `.buffer`
      // hands the decoder every neighbouring allocation as well.
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

  it(
    'converts a page of unclosed `<` in linear time',
    async () => {
      const started = performance.now();
      const result = await fetchHtml('<'.repeat(PUMP));
      expect(performance.now() - started).toBeLessThan(BUDGET_MS);
      expect(result.success).toBe(true);
    },
    RED_TIMEOUT_MS,
  );

  it(
    'converts a page of unclosed `<script` in linear time',
    async () => {
      const started = performance.now();
      const result = await fetchHtml('<script'.repeat(Math.floor(PUMP / 7)));
      expect(performance.now() - started).toBeLessThan(BUDGET_MS);
      expect(result.success).toBe(true);
    },
    RED_TIMEOUT_MS,
  );

  it('keeps the extracted text for a well-formed page', async () => {
    const page =
      '<html><head><style>body{color:red}</style><SCRIPT>var x = 1 < 2;</SCRIPT></head>' +
      '<body><p class="a">Hi &amp; bye</p><!-- note --></body></html>';
    expect((await fetchHtml(page)).output).toBe('Hi & bye');
  });

  it('leaves a literal `<>` in the text, as the previous regex did', async () => {
    expect((await fetchHtml('<p>a &lt;&gt; b</p>')).output).toBe('a <> b');
    expect((await fetchHtml('<p>a<>b</p>')).output).toBe('a<>b');
  });
});
