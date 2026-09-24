import { afterEach, describe, expect, it } from 'vitest';

import { startMockMcpServer } from './mock-mcp-server.js';
import {
  MCPSessionError,
  openMcpSession,
  SUPPORTED_MCP_PROTOCOL_VERSIONS,
} from '../client/session.js';
import { admitHttpEndpoint, constructStreamableHttpTransport } from '../client/transport.js';

import type { IMockMcpServer } from './mock-mcp-server.js';
import type { IMCPSession } from '../client/session.js';
import type { IEgressPolicy } from '@robota-sdk/agent-core/node';

/** The mock binds a literal loopback IP; `allowedHosts` skips DNS/private-address checks entirely. */
const LOOPBACK_POLICY: IEgressPolicy = { allowedHosts: ['127.0.0.1'] };

async function openSessionAgainst(
  server: IMockMcpServer,
  serverId = 'mock-server',
): Promise<IMCPSession> {
  const admission = await admitHttpEndpoint({ url: server.url }, { policy: LOOPBACK_POLICY });
  if (!admission.ok) {
    throw new Error(`test setup: admission unexpectedly refused: ${admission.reason}`);
  }
  const transport = constructStreamableHttpTransport(admission.admitted);
  return openMcpSession({
    serverId,
    transport,
    timeouts: { startupMs: 2_000, perCallMs: 2_000 },
  });
}

function requestMethods(server: IMockMcpServer): (string | undefined)[] {
  return server.requests.map((request) => request.body?.['method'] as string | undefined);
}

describe('openMcpSession — initialize (TC-01)', () => {
  let server: IMockMcpServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('stores the negotiated protocol version, serverInfo, instructions and capabilities', async () => {
    server = await startMockMcpServer({
      protocolVersion: '2025-03-26',
      serverInfo: { name: 'demo-server', version: '9.9.9' },
      capabilities: { tools: { listChanged: true }, prompts: {} },
      instructions: 'call the echo tool',
    });

    const session = await openSessionAgainst(server);
    try {
      const initialize = server.requests.find((request) => request.body?.['method'] === 'initialize');
      expect(initialize?.body?.['params']).toMatchObject({
        clientInfo: { name: 'mcp-client', version: '0.0.0' },
      });
      expect(session.identity).toEqual({
        serverId: 'mock-server',
        serverName: 'demo-server',
        serverVersion: '9.9.9',
        protocolVersion: '2025-03-26',
      });
      expect(session.instructions).toBe('call the echo tool');
      expect(session.declaredCapabilities.tools).toEqual({ listChanged: true });
      expect(session.declaredCapabilities.prompts).toEqual({ listChanged: false });
      expect(session.declaredCapabilities.resources).toBeUndefined();
    } finally {
      await session.close();
    }
  });

  it('disconnects rather than uses a server that negotiates an unsupported protocol version', async () => {
    // '2024-10-07' is in the SDK's own accepted list (so `Client.connect` itself does not reject
    // it) but is deliberately outside this package's SUPPORTED_MCP_PROTOCOL_VERSIONS — the gap
    // this unit's own post-connect check exists to close.
    expect(SUPPORTED_MCP_PROTOCOL_VERSIONS.has('2024-10-07')).toBe(false);
    server = await startMockMcpServer({ protocolVersion: '2024-10-07' });

    let caught: unknown;
    try {
      await openSessionAgainst(server);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MCPSessionError);
    expect((caught as MCPSessionError).kind).toBe('unsupported-protocol-version');

    // Only initialize + notifications/initialized were ever sent — no list/call request followed
    // the version check, and the session was torn down rather than used.
    expect(requestMethods(server)).toEqual(['initialize', 'notifications/initialized']);
  });
});
