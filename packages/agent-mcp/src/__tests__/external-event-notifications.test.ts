import { afterEach, describe, expect, it } from 'vitest';

import * as agentMcp from '../index.js';
import { openMcpSession } from '../client/session.js';
import { admitHttpEndpoint, constructStreamableHttpTransport } from '../client/transport.js';
import { startMockMcpServer } from './mock-mcp-server.js';

import type { IMockMcpServer } from './mock-mcp-server.js';
import type { IMCPSession } from '../client/session.js';

/** The retired sender-string event protocol a server may still declare and send. */
const RETIRED_CAPABILITY = 'com.robota.external-event';
const RETIRED_METHOD = 'notifications/com.robota/external-event';

async function openSession(server: IMockMcpServer): Promise<IMCPSession> {
  const admission = await admitHttpEndpoint(
    { url: server.url },
    { policy: { allowedHosts: ['127.0.0.1'] } },
  );
  if (!admission.ok) throw new Error('test MCP endpoint admission failed');
  return openMcpSession({
    serverId: 'chat',
    transport: constructStreamableHttpTransport(admission.admitted),
    timeouts: { startupMs: 2_000, perCallMs: 2_000 },
  });
}

describe('MCP server notifications are never an external-event carrier', () => {
  let server: IMockMcpServer | undefined;
  let session: IMCPSession | undefined;

  afterEach(async () => {
    await session?.close();
    await server?.close();
    session = undefined;
    server = undefined;
  });

  it('exports no external-event capability, method or listener', () => {
    expect(Object.keys(agentMcp).filter((name) => /external.?event/i.test(name))).toEqual([]);
    expect(
      Object.getOwnPropertyNames(agentMcp.MCPConnectionSupervisor.prototype).filter((name) =>
        /external.?event/i.test(name),
      ),
    ).toEqual([]);
  });

  it('offers no event port even when the server declares the retired capability', async () => {
    server = await startMockMcpServer({
      capabilities: { tools: {}, experimental: { [RETIRED_CAPABILITY]: { version: 1 } } },
    });
    session = await openSession(server);
    expect(Object.keys(session).filter((name) => /external.?event/i.test(name))).toEqual([]);
  });

  it('ignores a retired event notification and keeps serving tool calls', async () => {
    server = await startMockMcpServer({
      capabilities: { tools: {}, experimental: { [RETIRED_CAPABILITY]: { version: 1 } } },
    });
    session = await openSession(server);
    server.queueNotification({
      method: RETIRED_METHOD,
      params: { senderId: 'alice', conversationId: 'chat-1', content: 'hello' },
    });
    await expect(session.callTool('echo', {})).resolves.toMatchObject({ isError: false });
    await expect(session.callTool('echo', {})).resolves.toMatchObject({ isError: false });
  });
});
