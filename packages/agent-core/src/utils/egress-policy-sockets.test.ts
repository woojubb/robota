import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithEgressPolicy, postWithEgressPolicy } from './egress-policy.js';

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function fixture(handler?: (request: IncomingMessage, response: ServerResponse) => void) {
  const requests: { host?: string; method?: string; body: string }[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        host: request.headers.host,
        method: request.method,
        body: Buffer.concat(chunks).toString(),
      });
      if (handler) handler(request, response);
      else response.end('fixture-canary');
    });
  });
  servers.push(server);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Fixture listener unavailable');
  return { port: address.port, requests, sockets };
}

describe('actual HTTP destination pinning and connection cleanup', () => {
  it('connects GET only to the single resolved address while preserving the original Host', async () => {
    const f = await fixture();
    // The name deliberately cannot resolve in the OS. The owner permits this private fixture only.
    const lookup = vi.fn().mockResolvedValueOnce(['127.0.0.1']).mockResolvedValue(['127.0.0.2']);
    const url = `http://pinned-fixture.invalid:${f.port}/`;
    const result = await fetchWithEgressPolicy(
      url,
      { timeoutMs: 1000 },
      { allowedHosts: ['pinned-fixture.invalid'] },
      { lookup },
    );
    expect(result.ok).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(f.requests).toEqual([
      { host: `pinned-fixture.invalid:${f.port}`, method: 'GET', body: '' },
    ]);
  });

  it('connects POST to the pinned address and never falls back to an OS resolution', async () => {
    const f = await fixture();
    const lookup = vi.fn(async () => ['127.0.0.1']);
    const result = await postWithEgressPolicy(
      `http://pinned-fixture.invalid:${f.port}/`,
      { body: 'fixture-body', timeoutMs: 1000 },
      { allowedHosts: ['pinned-fixture.invalid'] },
      { lookup },
    );
    expect(result.ok).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(f.requests).toEqual([
      { host: `pinned-fixture.invalid:${f.port}`, method: 'POST', body: 'fixture-body' },
    ]);
  });

  it('releases the actual connection when a successful bounded exchange finishes', async () => {
    const f = await fixture();
    const result = await fetchWithEgressPolicy(
      `http://127.0.0.1:${f.port}/`,
      {},
      { allowPrivateAddresses: true },
    );
    expect(result.ok).toBe(true);
    const deadline = Date.now() + 500;
    while (f.sockets.size !== 0 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(f.sockets.size).toBe(0);
    expect(f.requests).toHaveLength(1);
  });
});

describe('default transport refusal and lifetime', () => {
  it('refuses private/mixed/malformed DNS answers without contacting the same healthy positive-control server', async () => {
    const f = await fixture();
    const url = `http://pinned-fixture.invalid:${f.port}/`;
    for (const answers of [['127.0.0.1'], ['8.8.8.8', '127.0.0.1'], ['not-an-ip']]) {
      const result = await fetchWithEgressPolicy(
        url,
        { timeoutMs: 1000 },
        {},
        { lookup: async () => answers },
      );
      expect(result.ok).toBe(false);
    }
    expect(f.requests).toHaveLength(0);
    expect(
      (
        await fetchWithEgressPolicy(
          url,
          {},
          { allowedHosts: ['pinned-fixture.invalid'] },
          { lookup: async () => ['127.0.0.1'] },
        )
      ).ok,
    ).toBe(true);
    expect(f.requests).toHaveLength(1);
  });

  it('does not fall back to a different resolver when an allowed host cannot resolve', async () => {
    const f = await fixture();
    const result = await fetchWithEgressPolicy(
      `http://pinned-fixture.invalid:${f.port}/`,
      {},
      { allowedHosts: ['pinned-fixture.invalid'] },
      {
        lookup: async () => {
          throw new Error('Fixture DNS outage');
        },
      },
    );
    expect(result).toMatchObject({ ok: false, rejection: { reason: 'unresolvable' } });
    expect(f.requests).toHaveLength(0);
  });

  it('applies the whole-exchange deadline to a resolver that never returns', async () => {
    const f = await fixture();
    await expect(
      fetchWithEgressPolicy(
        `http://pinned-fixture.invalid:${f.port}/`,
        { timeoutMs: 20 },
        {},
        { lookup: () => new Promise(() => {}) },
      ),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(f.requests).toHaveLength(0);
  });

  it('closes a real connection after refusing the response byte cap', async () => {
    const f = await fixture();
    const result = await fetchWithEgressPolicy(
      `http://127.0.0.1:${f.port}/`,
      { maxResponseBytes: 4 },
      { allowPrivateAddresses: true },
    );
    expect(result).toMatchObject({ ok: false, rejection: { reason: 'response_too_large' } });
    const deadline = Date.now() + 500;
    while (f.sockets.size !== 0 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(f.sockets.size).toBe(0);
  });

  it('aborts and closes a real streaming connection without waiting for the server to end its body', async () => {
    const controller = new AbortController();
    const sockets = new Set<Socket>();
    let count = 0;
    const server = createServer((_, response) => {
      count += 1;
      response.writeHead(200);
      response.write('partial');
      setTimeout(() => controller.abort(), 20);
    });
    servers.push(server);
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Streaming fixture unavailable');
    await expect(
      fetchWithEgressPolicy(
        `http://127.0.0.1:${address.port}/`,
        { signal: controller.signal },
        { allowPrivateAddresses: true },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const deadline = Date.now() + 500;
    while (sockets.size !== 0 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(count).toBe(1);
    expect(sockets.size).toBe(0);
  });
});

describe('actual redirect policy on pinned exchanges', () => {
  it('revalidates a redirected host and does not contact its private address', async () => {
    let port = 0;
    const f = await fixture((_, response) => {
      response.writeHead(302, { location: `http://other-fixture.invalid:${port}/target` });
      response.end('redirect');
    });
    port = f.port;
    const lookup = vi.fn(async () => ['127.0.0.1']);
    const result = await fetchWithEgressPolicy(
      `http://source-fixture.invalid:${port}/`,
      {},
      { allowedHosts: ['source-fixture.invalid'] },
      { lookup },
    );
    expect(result).toMatchObject({ ok: false, rejection: { reason: 'private_destination' } });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(f.requests).toHaveLength(1);
  });

  it('pins each allowed origin and strips credential headers on a cross-origin redirect', async () => {
    let port = 0;
    const authorization: (string | undefined)[] = [];
    const f = await fixture((request, response) => {
      authorization.push(request.headers.authorization);
      if (request.url === '/target') response.end('target-canary');
      else {
        response.writeHead(302, { location: `http://other-fixture.invalid:${port}/target` });
        response.end('redirect');
      }
    });
    port = f.port;
    const lookup = vi.fn(async () => ['127.0.0.1']);
    const result = await fetchWithEgressPolicy(
      `http://source-fixture.invalid:${port}/`,
      { headers: { Authorization: 'fixture-canary-auth' } },
      { allowedHosts: ['source-fixture.invalid', 'other-fixture.invalid'] },
      { lookup },
    );
    expect(result.ok).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(authorization).toEqual(['fixture-canary-auth', undefined]);
    expect(f.requests.map((request) => request.host)).toEqual([
      `source-fixture.invalid:${port}`,
      `other-fixture.invalid:${port}`,
    ]);
  });

  it('does not resend a POST body or resolve its redirect destination', async () => {
    const f = await fixture((_, response) => {
      response.writeHead(307, { location: 'http://other-fixture.invalid/target' });
      response.end('redirect');
    });
    const lookup = vi.fn(async () => ['127.0.0.1']);
    const result = await postWithEgressPolicy(
      `http://source-fixture.invalid:${f.port}/`,
      { body: 'fixture-body' },
      { allowedHosts: ['source-fixture.invalid'] },
      { lookup },
    );
    expect(result).toMatchObject({ ok: false, rejection: { reason: 'redirect_refused' } });
    expect(f.requests).toHaveLength(1);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
