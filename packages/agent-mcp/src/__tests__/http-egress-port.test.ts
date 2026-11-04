import { describe, expect, it, vi } from 'vitest';

import { MCPTransportEgressRefusedError, createWebFetchEgress } from '../client/http-egress.js';
import { classifyMcpFailure } from '../supervisor/connection.js';
import {
  admitHttpEndpoint,
  constructStreamableHttpTransport,
  createStreamableHttpAdapter,
} from '../client/transport.js';
import { createNodeHttpEgress } from '../node/http-egress.js';

/**
 * The HTTP transport's network is a required port: nothing here has a default, so an omitted egress
 * refuses instead of reaching any URL. The web egress is what a browser host passes on purpose, and
 * the Node egress adds name resolution, private-address refusal and a pinned connection. All of it
 * is checked without a socket.
 */
describe('a transport given no egress', () => {
  it('is a type error, and at runtime refuses every URL before anything is sent', async () => {
    const send = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', send);
    try {
      // @ts-expect-error the egress is required, so a call without one does not compile
      const adapter = createStreamableHttpAdapter();
      for (const url of [
        'https://mcp.example.com/mcp',
        'http://169.254.169.254/latest/meta-data/',
        'http://127.0.0.1:9/mcp',
      ]) {
        expect(await adapter.admit({ url })).toMatchObject({
          ok: false,
          reason: 'egress-unavailable',
        });
        // @ts-expect-error the egress is required here too
        expect(await admitHttpEndpoint({ url })).toMatchObject({
          ok: false,
          reason: 'egress-unavailable',
        });
      }
      expect(send).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses the shape an earlier version took, which has no egress', async () => {
    const lookup = vi.fn(async () => ['93.184.216.34']);
    const olderShape = { policy: { allowedHosts: ['127.0.0.1'] }, lookup } as never;
    expect(await admitHttpEndpoint({ url: 'http://127.0.0.1:9/mcp' }, olderShape)).toMatchObject({
      ok: false,
      reason: 'egress-unavailable',
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses to construct from an admitted endpoint that carries none', () => {
    const send = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', send);
    try {
      const handBuilt = {
        kind: 'streamable-http',
        url: new URL('https://mcp.example.com/mcp'),
        headers: {},
      } as never;
      let failure: unknown;
      try {
        constructStreamableHttpTransport(handBuilt);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(MCPTransportEgressRefusedError);
      expect(failure).toMatchObject({ reason: 'egress-unavailable' });
      expect(classifyMcpFailure(failure)).toBe('config');
      expect(send).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the web fetch egress (a browser host passes it on purpose)', () => {
  it('admits a public https URL without resolving anything', async () => {
    const admission = await admitHttpEndpoint(
      { url: 'https://mcp.example.com/mcp' },
      { egress: createWebFetchEgress() },
    );
    expect(admission.ok).toBe(true);
  });

  it.each(['ftp://mcp.example.com/mcp', 'file:///etc/passwd', 'data:text/plain,hello'])(
    'refuses %s as an unsupported scheme',
    async (url) => {
      const admission = await admitHttpEndpoint({ url }, { egress: createWebFetchEgress() });
      expect(admission).toMatchObject({ ok: false, reason: 'egress-policy:unsupported_scheme' });
    },
  );

  it('judges no address: a loopback host is admitted, which is why a server-side host injects the Node egress', async () => {
    const web = { egress: createWebFetchEgress() };
    expect((await admitHttpEndpoint({ url: 'http://127.0.0.1:9/mcp' }, web)).ok).toBe(true);
    const node = { egress: createNodeHttpEgress() };
    expect(await admitHttpEndpoint({ url: 'http://127.0.0.1:9/mcp' }, node)).toMatchObject({
      ok: false,
      reason: 'egress-policy:private_destination',
    });
  });

  it('sends the admitted endpoint through the injected fetch, never following a redirect', async () => {
    const send = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 202 }));
    const adapter = createStreamableHttpAdapter({ egress: createWebFetchEgress(send) });
    const admission = await adapter.admit({ url: 'https://mcp.example.com/mcp' });
    if (!admission.ok) throw new Error('not admitted');
    const transport = adapter.construct(admission.admitted);

    await transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' });

    expect(send).toHaveBeenCalledTimes(1);
    const [input, init] = send.mock.calls[0]!;
    expect(String(input)).toBe('https://mcp.example.com/mcp');
    expect(init?.redirect).toBe('manual');
    await transport.close();
  });

  it('uses the global fetch when it is given none', async () => {
    const send = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', send);
    try {
      const adapter = createStreamableHttpAdapter({ egress: createWebFetchEgress() });
      const admission = await adapter.admit({ url: 'https://mcp.example.com/mcp' });
      if (!admission.ok) throw new Error('not admitted');
      const transport = adapter.construct(admission.admitted);
      await transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
      expect(send).toHaveBeenCalledTimes(1);
      await transport.close();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses to send to any URL but the admitted one', async () => {
    const send = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 202 }));
    const carrier = createWebFetchEgress(send).open('https://mcp.example.com/mcp');

    const failure = await carrier.fetch('https://other.example.com/mcp').catch((error) => error);

    expect(failure).toBeInstanceOf(MCPTransportEgressRefusedError);
    expect(failure).toMatchObject({ reason: 'endpoint-mismatch' });
    expect(send).not.toHaveBeenCalled();
  });

  it('withdraws a request still waiting on the network when the carrier closes', async () => {
    const send = vi.fn<typeof globalThis.fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        }),
    );
    const carrier = createWebFetchEgress(send).open('https://mcp.example.com/mcp');
    const pending = carrier.fetch('https://mcp.example.com/mcp', { method: 'POST' });
    const rejected = expect(pending).rejects.toBeDefined();

    await carrier.close();

    await rejected;
    expect(carrier.signal.aborted).toBe(true);
  });
});

describe('the Node egress', () => {
  it('refuses a destination that resolves privately and admits one that does not, from the resolved address', async () => {
    const egress = createNodeHttpEgress({
      lookup: async (host) => (host === 'a.test' ? ['10.0.0.1'] : ['93.184.216.34']),
    });
    expect(await egress.admit(new URL('https://a.test/mcp'))).toMatchObject({
      reason: 'private_destination',
    });
    expect(await egress.admit(new URL('https://b.test/mcp'))).toBeUndefined();
  });

  it('copies the policy, so changing the object passed in cannot widen an endpoint admitted earlier', async () => {
    const allowedHosts = ['internal.test'];
    const egress = createNodeHttpEgress({
      policy: { allowedHosts },
      lookup: async () => ['10.0.0.1'],
    });
    expect(await egress.admit(new URL('https://internal.test/mcp'))).toBeUndefined();
    allowedHosts.splice(0, allowedHosts.length, 'other.test');
    expect(await egress.admit(new URL('https://internal.test/mcp'))).toBeUndefined();
  });
});
