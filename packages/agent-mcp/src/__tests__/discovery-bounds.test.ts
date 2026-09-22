import { afterEach, describe, expect, it } from 'vitest';

import { mockTools, startMockMcpServer } from './mock-mcp-server.js';
import { openMcpSession } from '../client/session.js';
import { admitHttpEndpoint, constructStreamableHttpTransport } from '../client/transport.js';

import type { IMockMcpServer } from './mock-mcp-server.js';
import type { IMCPSession } from '../client/session.js';
import type { IEgressPolicy } from '@robota-sdk/agent-core/node';

const LOOPBACK_POLICY: IEgressPolicy = { allowedHosts: ['127.0.0.1'] };

async function openSessionAgainst(server: IMockMcpServer): Promise<IMCPSession> {
  const admission = await admitHttpEndpoint({ url: server.url }, { policy: LOOPBACK_POLICY });
  if (!admission.ok) {
    throw new Error(`test setup: admission unexpectedly refused: ${admission.reason}`);
  }
  const transport = constructStreamableHttpTransport(admission.admitted);
  return openMcpSession({
    serverId: 'mock-server',
    transport,
    timeouts: { startupMs: 2_000, perCallMs: 2_000 },
  });
}

describe('MCP discovery bounds (TC-19)', () => {
  let server: IMockMcpServer | undefined;
  let session: IMCPSession | undefined;

  afterEach(async () => {
    await session?.close();
    await server?.close();
    session = undefined;
    server = undefined;
  });

  it('stops at the declared page bound with a named refusal instead of looping forever', async () => {
    server = await startMockMcpServer({
      capabilities: { tools: {} },
      tools: mockTools(2),
      pageSize: 1,
      // Every page carries a fresh nextCursor forever: the caller-owned bound is the only thing
      // that can end this loop.
      endlessCursor: true,
    });
    session = await openSessionAgainst(server);

    let caught: unknown;
    try {
      await session.discover({ maxPages: 3, perRequestTimeoutMs: 2_000 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      name: 'MCPDiscoveryError',
      failure: { kind: 'page-bound-exceeded', domain: 'tools' },
    });

    const listRequests = server.requests.filter((r) => r.body?.['method'] === 'tools/list');
    // Exactly `maxPages` requests were made — the loop stopped before issuing a 4th.
    expect(listRequests).toHaveLength(3);
  });

  it('classifies a per-request timeout as its own failure, distinct from a page-bound refusal', async () => {
    server = await startMockMcpServer({
      capabilities: { tools: {} },
      tools: mockTools(1),
      listDelayMs: 300,
    });
    session = await openSessionAgainst(server);

    let caught: unknown;
    try {
      await session.discover({ maxPages: 5, perRequestTimeoutMs: 50 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      name: 'MCPDiscoveryError',
      failure: { kind: 'timeout', domain: 'tools' },
    });
  });
});
