import { describe, expect, it } from 'vitest';

import { classifyMcpFailure } from '../supervisor/connection.js';
import {
  admitHttpEndpoint,
  MCPTransportRedirectRefusedError,
  createStreamableHttpAdapter,
} from '../client/transport.js';

import { createWebFetchEgress } from '../client/http-egress.js';
import { createNodeHttpEgress } from '../node/http-egress.js';

import type { TEgressLookup } from '@robota-sdk/agent-core/node';

/**
 * The admitted URL is the only URL spoken to (`transport.ts` § redirect refusal). A redirect from
 * the admitted origin — even a same-origin-looking one — is refused rather than followed, because
 * following it would hand headers set for the admitted destination to a second, un-admitted one.
 */
function redirectStub(): {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: { readonly input: unknown; readonly init: RequestInit | undefined }[];
} {
  const calls: { readonly input: unknown; readonly init: RequestInit | undefined }[] = [];
  const fetchStub = (async (input: unknown, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
    });
  }) as typeof globalThis.fetch;
  return { fetch: fetchStub, calls };
}

describe('constructStreamableHttpTransport — redirect refusal', () => {
  it('refuses a redirect from the admitted origin instead of following it, exactly once', async () => {
    const { fetch: fetchStub, calls } = redirectStub();
    const lookup: TEgressLookup = async () => ['203.0.113.9'];

    const adapter = createStreamableHttpAdapter({ egress: createNodeHttpEgress({ fetch: fetchStub, lookup }) });
    const admission = await adapter.admit({
      url: 'https://mcp.example.test/mcp',
      headers: { 'x-custom': 'trusted-for-admitted-origin' },
    });

    expect(admission.ok).toBe(true);
    if (!admission.ok) {
      return;
    }

    const transport = adapter.construct(admission.admitted);

    const caught: unknown = await transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.redirect).toBe('manual');

    expect(caught).toBeInstanceOf(MCPTransportRedirectRefusedError);
    const redirectError = caught as MCPTransportRedirectRefusedError;
    expect(redirectError.status).toBe(302);
    expect(redirectError.location).toBe('http://169.254.169.254/latest/meta-data/');

    expect(classifyMcpFailure(caught)).toBe('config');
  });

  it('classifies a redirect refusal as config regardless of the Location text (it never reaches the message heuristics)', () => {
    const admitted = 'https://mcp.example.test/mcp';
    for (const location of [
      'https://mcp.example.test/unauthorized',
      'https://mcp.example.test/v401/',
      'https://mcp.example.test/not found',
      'https://mcp.example.test/timeout',
      undefined,
    ]) {
      const error = new MCPTransportRedirectRefusedError(302, location, admitted);
      expect(classifyMcpFailure(error), `location=${String(location)}`).toBe('config');
    }
  });

  it('refuses a redirect a browser hides: an opaqueredirect response has status 0 and no Location', async () => {
    // Under the Fetch standard `redirect: 'manual'` answers with an opaque filtered response, so no
    // 300-399 status is ever seen. `new Response` cannot be built that way; the stub says what a
    // browser's `fetch` reports.
    const opaque = new Response(null);
    Object.defineProperties(opaque, {
      type: { value: 'opaqueredirect' },
      status: { value: 0 },
      ok: { value: false },
    });
    const adapter = createStreamableHttpAdapter({
      egress: createWebFetchEgress(async () => opaque),
    });
    const admission = await adapter.admit({ url: 'https://mcp.example.test/mcp' });
    if (!admission.ok) throw new Error('not admitted');
    const transport = adapter.construct(admission.admitted);

    const caught: unknown = await transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(MCPTransportRedirectRefusedError);
    expect((caught as MCPTransportRedirectRefusedError).location).toBeUndefined();
    expect((caught as Error).message).toContain('refused a redirect (opaque)');
    expect(classifyMcpFailure(caught)).toBe('config');
    await transport.close();
  });

  it('names origins only, so a credential in a path or query never reaches the message', () => {
    const error = new MCPTransportRedirectRefusedError(
      302,
      '/login?session=sess-secret',
      'https://mcp.example.test/mcp?key=tok-secret',
    );
    expect(error.message).toContain('https://mcp.example.test');
    expect(error.message).not.toContain('tok-secret');
    expect(error.message).not.toContain('sess-secret');
  });

  it('does not print a URL it cannot parse, which may hold an expanded credential', async () => {
    const admission = await admitHttpEndpoint(
      { url: 'https://${HOST}/mcp?key=tok-secret' },
      { egress: createNodeHttpEgress() },
    );
    expect(admission.ok).toBe(false);
    expect(JSON.stringify(admission)).not.toContain('tok-secret');
  });
});
