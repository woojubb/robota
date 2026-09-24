import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startMockMcpServer } from './mock-mcp-server.js';
import {
  MCP_EXTERNAL_EVENT_CAPABILITY,
  MCP_EXTERNAL_EVENT_METHOD,
  openMcpSession,
} from '../client/session.js';
import { admitHttpEndpoint, constructStreamableHttpTransport } from '../client/transport.js';

import type { IMockMcpServer } from './mock-mcp-server.js';
import type { IMCPSession } from '../client/session.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

const EVENT = { senderId: 'alice', conversationId: 'chat-1', content: 'hello' };

async function openSession(
  server: IMockMcpServer,
  onTransport?: (transport: Transport) => void,
): Promise<IMCPSession> {
  const admission = await admitHttpEndpoint(
    { url: server.url },
    { policy: { allowedHosts: ['127.0.0.1'] } },
  );
  if (!admission.ok) throw new Error('test MCP endpoint admission failed');
  const transport = constructStreamableHttpTransport(admission.admitted);
  onTransport?.(transport);
  return openMcpSession({
    serverId: 'chat',
    transport,
    timeouts: { startupMs: 2_000, perCallMs: 2_000 },
  });
}

async function send(server: IMockMcpServer, session: IMCPSession, params: unknown): Promise<void> {
  server.queueNotification({ method: MCP_EXTERNAL_EVENT_METHOD, params });
  await session.callTool('echo', {});
}

describe('external event MCP notifications', () => {
  let server: IMockMcpServer | undefined;
  let session: IMCPSession | undefined;

  afterEach(async () => {
    await session?.close();
    await server?.close();
    session = undefined;
    server = undefined;
  });

  it('delivers validated events only after the server declares the supported capability', async () => {
    server = await startMockMcpServer({
      capabilities: { tools: {}, experimental: { [MCP_EXTERNAL_EVENT_CAPABILITY]: { version: 1 } } },
    });
    session = await openSession(server);
    expect(session.externalEventsDeclared).toBe(true);
    const received: unknown[] = [];
    const unsubscribe = session.onExternalEvent((event) => received.push(event));
    await send(server, session, EVENT);
    expect(received).toEqual([EVENT]);
    unsubscribe();
    await send(server, session, EVENT);
    expect(received).toEqual([EVENT]);
  });

  it.each([
    undefined,
    { version: 2 },
    { version: '1' },
  ])('does not subscribe for an absent or unsupported capability: %s', async (declaration) => {
    server = await startMockMcpServer({
      capabilities: {
        tools: {},
        ...(declaration ? { experimental: { [MCP_EXTERNAL_EVENT_CAPABILITY]: declaration } } : {}),
      },
    });
    session = await openSession(server);
    expect(session.externalEventsDeclared).toBe(false);
    const received: unknown[] = [];
    session.onExternalEvent((event) => received.push(event));
    await send(server, session, EVENT);
    expect(received).toEqual([]);
  });

  it('drops malformed event params without delivering them to the host', async () => {
    server = await startMockMcpServer({
      capabilities: { tools: {}, experimental: { [MCP_EXTERNAL_EVENT_CAPABILITY]: { version: 1 } } },
    });
    session = await openSession(server);
    const received: unknown[] = [];
    session.onExternalEvent((event) => received.push(event));
    await send(server, session, { ...EVENT, content: 42 });
    await send(server, session, { ...EVENT, senderId: '' });
    await send(server, session, { ...EVENT, content: 'x'.repeat(16_385) });
    expect(received).toEqual([]);
  });

  it('stops delivery when the session closes', async () => {
    server = await startMockMcpServer({
      capabilities: { tools: {}, experimental: { [MCP_EXTERNAL_EVENT_CAPABILITY]: { version: 1 } } },
    });
    let transport: Transport | undefined;
    session = await openSession(server, (opened) => { transport = opened; });
    const received: unknown[] = [];
    session.onExternalEvent((event) => received.push(event));
    await send(server, session, EVENT);
    expect(received).toEqual([EVENT]);
    const lateMessage = transport?.onmessage;
    await session.close();
    await session.close();
    // Simulate a notification already queued by the transport when close began.
    lateMessage?.({ jsonrpc: '2.0', method: MCP_EXTERNAL_EVENT_METHOD, params: EVENT });
    await Promise.resolve();
    await Promise.resolve();
    expect(received).toEqual([EVENT]);
  });

  it('ends subscriptions when the transport closes unexpectedly', async () => {
    server = await startMockMcpServer({
      capabilities: { tools: {}, experimental: { [MCP_EXTERNAL_EVENT_CAPABILITY]: { version: 1 } } },
    });
    let transport: Transport | undefined;
    session = await openSession(server, (opened) => { transport = opened; });
    const received: unknown[] = [];
    session.onExternalEvent((event) => received.push(event));
    let closes = 0;
    session.onClose(() => { closes += 1; });
    await send(server, session, EVENT);
    expect(received).toEqual([EVENT]);

    const lateMessage = transport?.onmessage;
    transport?.onclose?.();
    expect(closes).toBe(1);
    session.onExternalEvent((event) => received.push(event));
    lateMessage?.({ jsonrpc: '2.0', method: MCP_EXTERNAL_EVENT_METHOD, params: EVENT });
    await Promise.resolve();
    await Promise.resolve();
    expect(received).toEqual([EVENT]);
    await session.close();
    expect(closes).toBe(1);
  });

  it('does not announce a self-close until transport cleanup finishes', async () => {
    server = await startMockMcpServer({
      capabilities: { tools: {}, experimental: { [MCP_EXTERNAL_EVENT_CAPABILITY]: { version: 1 } } },
    });
    session = await openSession(server);
    const originalClose = Client.prototype.close;
    let finishCleanup: (() => void) | undefined;
    const cleanup = new Promise<void>((resolve) => { finishCleanup = resolve; });
    const spy = vi.spyOn(Client.prototype, 'close').mockImplementation(async function (this: Client) {
      await cleanup;
      await originalClose.call(this);
    });
    try {
      let closes = 0;
      session.onClose(() => { closes += 1; });
      const closing = session.close();
      expect(closes).toBe(0);
      finishCleanup?.();
      await closing;
      expect(closes).toBe(1);
    } finally {
      spy.mockRestore();
      finishCleanup?.();
    }
  });

  it('does not trigger reconnect on a self-close whose cleanup fails', async () => {
    server = await startMockMcpServer({
      capabilities: { tools: {}, experimental: { [MCP_EXTERNAL_EVENT_CAPABILITY]: { version: 1 } } },
    });
    let transport: Transport | undefined;
    session = await openSession(server, (opened) => { transport = opened; });
    const spy = vi.spyOn(Client.prototype, 'close').mockRejectedValueOnce(new Error('cleanup failed'));
    try {
      let closes = 0;
      session.onClose(() => { closes += 1; });
      await expect(session.close()).rejects.toThrow('cleanup failed');
      expect(closes).toBe(0);
    } finally {
      spy.mockRestore();
      session = undefined;
      await transport?.close();
    }
  });
});
