import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamableHttpAdapter } from '../client/transport.js';
import { openMcpSession } from '../client/session.js';
import { MCPTransportEgressRefusedError } from '../client/pinned-http-fetch.js';
import { classifyMcpFailure } from '../supervisor/connection.js';
import { startMockMcpServer } from './mock-mcp-server.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe('actual MCP pinned HTTP requests and stream lifetime', () => {
  it('pins an authentication retry and sends only the fresh fixture credential to the admitted Host', async () => {
    const server = await startMockMcpServer({ capabilities: {}, unauthorizedFirstRequests: 1 });
    cleanups.push(() => server.close());
    const url = new URL(server.url);
    url.hostname = 'pinned-mcp-fixture.invalid';
    let authorizations = 0;
    const rejected = vi.fn(async () => 'retry' as const);
    const lookup = vi.fn(async () => ['127.0.0.1']);
    const adapter = createStreamableHttpAdapter({ policy: { allowedHosts: [url.hostname] }, lookup });
    const admission = await adapter.admit({ url: url.href, authentication: {
      serverId: 'fixture', securityIdentity: 'fixture-only', authenticator: {
        authorize: async () => ({ Authorization: `fixture-${++authorizations}` }), onRejected: rejected,
      },
    } });
    if (!admission.ok) throw new Error('Fixture endpoint was not admitted');
    const session = await openMcpSession({ serverId: 'fixture', transport: adapter.construct(admission.admitted), timeouts: { startupMs: 1000, perCallMs: 1000 } });
    cleanups.unshift(() => session.close());
    expect(server.requests.filter((request) => request.method === 'POST').map((request) => request.headers.authorization)).toEqual(['fixture-1', 'fixture-2', 'fixture-3']);
    expect(server.requests.every((request) => request.headers.host === url.host)).toBe(true);
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('does not dispatch a late owner authorization or request another credential after transport close', async () => {
    let resolveAuthorization!: (headers: Readonly<Record<string, string>>) => void;
    let started!: () => void;
    const authorizing = new Promise<void>((resolve) => { started = resolve; });
    const authorize = vi.fn(() => {
      started();
      return new Promise<Readonly<Record<string, string>>>((resolve) => { resolveAuthorization = resolve; });
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 202 }));
    const adapter = createStreamableHttpAdapter({ lookup: async () => ['8.8.8.8'], fetch });
    const admission = await adapter.admit({ url: 'https://mcp-fixture.invalid/mcp', authentication: {
      serverId: 'fixture', securityIdentity: 'fixture-only', authenticator: { authorize, onRejected: async () => 'fail' },
    } });
    if (!admission.ok) throw new Error('Fixture endpoint was not admitted');
    const transport = adapter.construct(admission.admitted);
    cleanups.unshift(async () => { resolveAuthorization?.({ Authorization: 'fixture-only' }); await transport.close(); });
    const pending = transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    const rejected = expect(pending).rejects.toThrow();
    await authorizing;
    await transport.close();
    resolveAuthorization({ Authorization: 'fixture-only' });
    await rejected;
    await expect(transport.send({ jsonrpc: '2.0', id: 2, method: 'ping' })).rejects.toThrow();
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('initializes through the injected address with the original Host and no OS DNS fallback', async () => {
    const server = await startMockMcpServer({ capabilities: {} });
    cleanups.push(() => server.close());
    const url = new URL(server.url);
    url.hostname = 'pinned-mcp-fixture.invalid';
    const lookup = vi.fn(async () => ['127.0.0.1']);
    const adapter = createStreamableHttpAdapter({
      policy: { allowedHosts: [url.hostname] },
      lookup,
    });
    const admission = await adapter.admit({ url: url.href });
    if (!admission.ok) throw new Error('Fixture endpoint was not admitted');
    const session = await openMcpSession({
      serverId: 'fixture',
      transport: adapter.construct(admission.admitted),
      timeouts: { startupMs: 1000, perCallMs: 1000 },
    });
    cleanups.unshift(() => session.close());
    expect(server.requests.filter((request) => request.method === 'POST')).toHaveLength(2);
    expect(server.requests.every((request) => request.headers.host === url.host)).toBe(true);
    expect(lookup.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('closes its actual persistent SSE stream and completed request connections on session close', async () => {
    const sockets = new Set<Socket>();
    let streams = 0;
    const server = createServer((request, response) => {
      if (request.method === 'GET') {
        streams += 1;
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(': fixture\n\n');
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const message = JSON.parse(Buffer.concat(chunks).toString()) as { id?: number; method?: string };
        if (message.method === 'initialize') {
          response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'fixture-session' });
          response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {
            protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture', version: '1' },
          } }));
        } else response.writeHead(202).end();
      });
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    cleanups.push(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture listener unavailable');
    const adapter = createStreamableHttpAdapter({ policy: { allowedHosts: ['127.0.0.1'] } });
    const admission = await adapter.admit({ url: `http://127.0.0.1:${address.port}/mcp` });
    if (!admission.ok) throw new Error('Fixture endpoint was not admitted');
    const session = await openMcpSession({ serverId: 'fixture', transport: adapter.construct(admission.admitted), timeouts: { startupMs: 1000, perCallMs: 1000 } });
    cleanups.unshift(() => session.close());
    const streamDeadline = Date.now() + 500;
    while (streams === 0 && Date.now() < streamDeadline) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(streams).toBe(1);
    await session.close();
    const closeDeadline = Date.now() + 500;
    while (sockets.size > 0 && Date.now() < closeDeadline) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(sockets.size).toBe(0);
  });

  it('rechecks DNS after admission before a trusted test carrier can contact a healthy private server', async () => {
    const server = await startMockMcpServer({ capabilities: {} });
    cleanups.push(() => server.close());
    const lookup = vi.fn().mockResolvedValueOnce(['8.8.8.8']).mockResolvedValue(['127.0.0.1']);
    const carrier = vi.fn<typeof globalThis.fetch>((_input, init) => globalThis.fetch(server.url, init));
    const adapter = createStreamableHttpAdapter({ lookup, fetch: carrier });
    const admission = await adapter.admit({ url: 'http://pinned-mcp-fixture.invalid/mcp' });
    if (!admission.ok) throw new Error('Public initial answer was not admitted');
    let failure: unknown;
    try {
      const session = await openMcpSession({ serverId: 'fixture', transport: adapter.construct(admission.admitted), timeouts: { startupMs: 1000, perCallMs: 1000 } });
      cleanups.unshift(() => session.close());
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(MCPTransportEgressRefusedError);
    expect(failure).toMatchObject({ reason: 'private_destination' });
    expect(classifyMcpFailure(failure)).toBe('config');
    expect(carrier).not.toHaveBeenCalled();
    expect(server.requests).toHaveLength(0);
  });

  it('resolves every actual SSE reconnect and preserves its resumption token', async () => {
    const hosts: (string | undefined)[] = [];
    const resumed: (string | undefined)[] = [];
    let streams = 0;
    const server = createServer((request, response) => {
      hosts.push(request.headers.host);
      if (request.method === 'GET') {
        streams += 1;
        resumed.push(request.headers['last-event-id'] as string | undefined);
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        if (streams === 1) response.end('retry: 10\nid: fixture-resumption\ndata: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n');
        else response.write(': fixture\n\n');
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const message = JSON.parse(Buffer.concat(chunks).toString()) as { id?: number; method?: string };
        if (message.method === 'initialize') {
          response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'fixture-session' });
          response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {
            protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture', version: '1' },
          } }));
        } else response.writeHead(202).end();
      });
    });
    cleanups.push(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture listener unavailable');
    const endpoint = new URL(`http://reconnect-mcp-fixture.invalid:${address.port}/mcp`);
    const lookup = vi.fn(async () => ['127.0.0.1']);
    const adapter = createStreamableHttpAdapter({ policy: { allowedHosts: [endpoint.hostname] }, lookup });
    const admission = await adapter.admit({ url: endpoint.href });
    if (!admission.ok) throw new Error('Fixture endpoint was not admitted');
    const session = await openMcpSession({ serverId: 'fixture', transport: adapter.construct(admission.admitted), timeouts: { startupMs: 1000, perCallMs: 1000 } });
    cleanups.unshift(() => session.close());
    const deadline = Date.now() + 1000;
    while (streams < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(streams).toBe(2);
    expect(resumed).toEqual([undefined, 'fixture-resumption']);
    expect(hosts.every((host) => host === endpoint.host)).toBe(true);
    // This fixture's explicit hostname allowlist skips admission DNS; every actual request resolves.
    expect(hosts).toHaveLength(4);
    expect(lookup).toHaveBeenCalledTimes(4);
    await session.close();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(streams).toBe(2);
  });
});
