import { describe, expect, it } from 'vitest';

import { classifyMcpFailure } from '../supervisor/connection.js';
import {
  MCPTransportRedirectRefusedError,
  createStreamableHttpAdapter,
} from '../client/transport.js';

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

    const adapter = createStreamableHttpAdapter({ fetch: fetchStub, lookup });
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
});
