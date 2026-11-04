import { describe, expect, it, vi } from 'vitest';

import { MCPTransportEgressRefusedError, createWebFetchEgress } from '../client/http-egress.js';
import {
  admitHttpEndpoint,
  constructStreamableHttpTransport,
  createStreamableHttpAdapter,
} from '../client/transport.js';
import { createNodeCallContext } from '../node/call-context.js';
import { createNodeHttpEgress, createNodeHttpTransportDeps } from '../node/http-egress.js';

/**
 * The HTTP transport's network is a port. Absent it, the transport sends through web `fetch` and
 * judges only the scheme; the Node egress adds name resolution, private-address refusal and a pinned
 * connection. Both are checked here without a socket.
 */
describe('the web fetch egress (no egress injected)', () => {
  it('admits a public https URL without resolving anything', async () => {
    const admission = await admitHttpEndpoint({ url: 'https://mcp.example.com/mcp' });
    expect(admission.ok).toBe(true);
  });

  it.each(['ftp://mcp.example.com/mcp', 'file:///etc/passwd', 'data:text/plain,hello'])(
    'refuses %s as an unsupported scheme',
    async (url) => {
      const admission = await admitHttpEndpoint({ url });
      expect(admission).toMatchObject({ ok: false, reason: 'egress-policy:unsupported_scheme' });
    },
  );

  it('judges no address: a loopback host is admitted, which is why a server-side host injects one', async () => {
    expect((await admitHttpEndpoint({ url: 'http://127.0.0.1:9/mcp' })).ok).toBe(true);
    const node = createNodeHttpTransportDeps();
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

  it('uses the global fetch when none is injected', async () => {
    const send = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', send);
    try {
      const admission = await admitHttpEndpoint({ url: 'https://mcp.example.com/mcp' });
      if (!admission.ok) throw new Error('not admitted');
      const transport = constructStreamableHttpTransport(admission.admitted);
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

describe('the Node egress and call context', () => {
  it('createNodeHttpTransportDeps carries both the egress and the call context', () => {
    const deps = createNodeHttpTransportDeps();
    expect(deps.egress).toBeDefined();
    expect(deps.callContext).toBeDefined();
  });

  it('refuses a destination that resolves privately and admits one that does not, from the resolved address', async () => {
    const egress = createNodeHttpEgress({ lookup: async (host) => (host === 'a.test' ? ['10.0.0.1'] : ['93.184.216.34']) });
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

  it('carries a scope through the async work a call starts, and gives each carrier its own storage', async () => {
    const first = createNodeCallContext();
    const second = createNodeCallContext();
    const scope = { requestId: 1 };
    const seen = await first.run(scope, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { inside: first.current(), other: second.current() };
    });
    expect(seen.inside).toBe(scope);
    expect(seen.other).toBeUndefined();
    expect(first.current()).toBeUndefined();
  });
});
