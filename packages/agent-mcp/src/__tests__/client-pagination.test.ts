import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';

import { mockTools, startMockMcpServer } from './mock-mcp-server.js';
import { discoverAll } from '../client/discovery.js';
import { openMcpSession } from '../client/session.js';
import { admitHttpEndpoint, constructStreamableHttpTransport } from '../client/transport.js';

import type { IMockMcpServer } from './mock-mcp-server.js';
import type { IMCPSession } from '../client/session.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
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

describe('MCP discovery pagination (TC-02)', () => {
  let server: IMockMcpServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('fully drains a three-page tools/list by following nextCursor until it is absent', async () => {
    // mockTools(4) yields 5 tools (tool-1..tool-4 plus echo); pageSize 2 forces exactly 3 pages
    // (2, 2, 1) and the last page's absent nextCursor is what must end the loop.
    server = await startMockMcpServer({
      capabilities: { tools: {} },
      tools: mockTools(4),
      pageSize: 2,
    });

    const session = await openSessionAgainst(server);
    try {
      const discovery = await session.discover({ maxPages: 10, perRequestTimeoutMs: 2_000 });

      expect(discovery.tools.pages).toBe(3);
      expect(discovery.tools.items).toHaveLength(5);
      expect(discovery.tools.items.map((tool) => tool.name)).toEqual([
        'tool-1',
        'tool-2',
        'tool-3',
        'tool-4',
        'echo',
      ]);
      expect(discovery.tools.state).toEqual({ kind: 'supported', count: 5, listChanged: false });

      const listRequests = server.requests.filter((r) => r.body?.['method'] === 'tools/list');
      expect(listRequests).toHaveLength(3);
    } finally {
      await session.close();
    }
  });

  it('surfaces a server-reported invalid cursor (-32602) as a named domain failure, never a partial catalog', async () => {
    // The real mock server only ever hands back cursors it will itself accept, so an invalid
    // cursor can never arise from a well-behaved client through the full HTTP round trip. This
    // exercises `discoverAll` directly against a minimal stand-in for the SDK `Client` whose
    // second `listTools` page rejects exactly as the SDK surfaces a JSON-RPC -32602 response.
    let call = 0;
    const stubClient = {
      listTools: async () => {
        call += 1;
        if (call === 1) {
          return {
            tools: [{ name: 'tool-1', inputSchema: { type: 'object' as const } }],
            nextCursor: 'page-2',
          };
        }
        throw new McpError(ErrorCode.InvalidParams, 'Invalid cursor');
      },
    } as unknown as Client;

    const declaredCapabilities = {
      tools: { listChanged: false },
      prompts: undefined,
      resources: undefined,
    };
    const identity = {
      serverId: 'mock-server',
      serverName: 'demo',
      serverVersion: '1.0.0',
      protocolVersion: '2025-03-26',
    };

    let caught: unknown;
    try {
      await discoverAll(stubClient, declaredCapabilities, identity, undefined, {
        maxPages: 10,
        perRequestTimeoutMs: 2_000,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      name: 'MCPDiscoveryError',
      failure: { kind: 'invalid-cursor', domain: 'tools', code: -32602 },
    });
    expect(call).toBe(2);
  });
});
