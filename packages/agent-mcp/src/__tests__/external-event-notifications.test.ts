import { afterEach, describe, expect, it } from 'vitest';

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
});
