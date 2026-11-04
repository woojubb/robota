/**
 * `@robota-sdk/agent-mcp`'s main entry is platform-neutral: it has no destination policy and no
 * pinned connection of its own, and refuses to admit an endpoint until its host gives it an egress.
 * The CLI is the Node host, so its composition must hand every Streamable HTTP server the Node
 * egress whatever options a caller passes. These tests go through `createMcpClientComposition` and
 * a real socket to show the composition still has the private-address refusal and the pinned
 * connection, and that a tool call still carries its own trace.
 */
import { createServer } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  InMemoryMCPActivationApprovalStore,
  MCPDefinitionRegistry,
  decodeSource,
  materializeDefinition,
} from '@robota-sdk/agent-mcp';

import { createMcpClientComposition } from '../mcp-client-composition.js';

import type { IMcpClientComposition } from '../mcp-client-composition.js';
import type { IncomingHttpHeaders, Server } from 'node:http';

interface IRecorded {
  readonly method: string | undefined;
  readonly headers: IncomingHttpHeaders;
}

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-a1a1a1a1a1a1a1a1-01';

let listener: Server | undefined;
let composition: IMcpClientComposition | undefined;
const requests: IRecorded[] = [];

afterEach(async () => {
  await composition?.shutdown();
  composition = undefined;
  await new Promise<void>((resolve) => (listener ? listener.close(() => resolve()) : resolve()));
  listener = undefined;
  requests.length = 0;
});

/** A legacy-era Streamable HTTP server that answers JSON for everything and records each request. */
async function startServer(): Promise<number> {
  listener = createServer((request, response) => {
    let text = '';
    request.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
    request.on('end', () => {
      const message = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
      requests.push({ method: message['method'] as string | undefined, headers: request.headers });
      if (request.method === 'GET') return void response.writeHead(405).end();
      if (request.method === 'DELETE') return void response.writeHead(204).end();
      const id = message['id'];
      const method = message['method'];
      if (typeof method === 'string' && method.startsWith('notifications/')) {
        return void response.writeHead(202).end();
      }
      const result =
        method === 'initialize'
          ? {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'fixture', version: '1' },
            }
          : method === 'tools/list'
            ? { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }] }
            : { content: [{ type: 'text', text: 'ok' }], isError: false };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
    });
  });
  await new Promise<void>((resolve) => listener!.listen(0, '127.0.0.1', resolve));
  const address = listener.address();
  if (address === null || typeof address === 'string') throw new Error('no listener');
  return address.port;
}

function entriesFor(url: string) {
  const decoded = decodeSource({ mcpServers: { remote: { type: 'http', url } } }, 'user', 'fixture');
  expect(decoded.problems).toEqual([]);
  return decoded.definitions.map((definition) => ({
    name: definition.name,
    source: definition.source,
    origin: definition.origin,
    status: 'resolved' as const,
    definition: materializeDefinition(definition, {}),
    shadowed: [],
  }));
}

function approvedStoreFor(entries: ReturnType<typeof entriesFor>) {
  const store = new InMemoryMCPActivationApprovalStore();
  for (const request of new MCPDefinitionRegistry(entries).list()) {
    store.put({
      ...request,
      approvalAuthority: 'user',
      decision: 'approved',
      decidedAt: new Date(0).toISOString(),
    });
  }
  return store;
}

describe('the CLI composition of a Streamable HTTP server', () => {
  it('refuses a loopback host with no transport options at all', async () => {
    const entries = entriesFor('http://localhost:9/mcp');
    const diagnostics: string[] = [];
    composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore: approvedStoreFor(entries),
      reportDiagnostic: (message) => diagnostics.push(message),
    });

    expect(await composition.connect()).toEqual([]);

    expect(diagnostics.join(' ')).toContain('egress-policy:metadata_host');
  });

  it('refuses a name that resolves to a private address, from the resolved address', async () => {
    const entries = entriesFor('https://internal.example.test/mcp');
    const diagnostics: string[] = [];
    const lookup = vi.fn(async () => ['10.0.0.5']);
    composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore: approvedStoreFor(entries),
      transport: { lookup },
      reportDiagnostic: (message) => diagnostics.push(message),
    });

    expect(await composition.connect()).toEqual([]);

    expect(lookup).toHaveBeenCalled();
    expect(diagnostics.join(' ')).toContain('egress-policy:private_destination');
  });

  it('connects only to the address it resolved, under the host name the definition gave', async () => {
    const port = await startServer();
    // `.invalid` never resolves through the operating system: reaching the server proves the
    // connection was pinned to the address the injected resolver returned.
    const entries = entriesFor(`http://pinned-fixture.invalid:${port}/mcp`);
    const lookup = vi.fn(async () => ['127.0.0.1']);
    composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore: approvedStoreFor(entries),
      transport: { policy: { allowedHosts: ['pinned-fixture.invalid'] }, lookup },
      reportDiagnostic: () => undefined,
    });

    const tools = await composition.connect();

    expect(tools).toHaveLength(1);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.headers.host === `pinned-fixture.invalid:${port}`)).toBe(
      true,
    );
    expect(lookup.mock.calls.length).toBeGreaterThanOrEqual(requests.length);
  });

  it('sends a tool call its own traceparent', async () => {
    const port = await startServer();
    const entries = entriesFor(`http://127.0.0.1:${port}/mcp`);
    composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore: approvedStoreFor(entries),
      transport: { policy: { allowedHosts: ['127.0.0.1'] } },
      reportDiagnostic: () => undefined,
    });
    const tools = await composition.connect();
    expect(tools).toHaveLength(1);

    const result = await tools[0]!.execute(
      {},
      {
        toolName: tools[0]!.getName(),
        parameters: {},
        outboundTraceContext: {
          traceparent: TRACEPARENT,
          allowedOrigins: [`http://127.0.0.1:${port}`],
        },
      },
    );

    expect(result.success).toBe(true);
    const calls = requests.filter((request) => request.method === 'tools/call');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers['traceparent']).toBe(TRACEPARENT);
    expect(
      requests
        .filter((request) => request.method !== 'tools/call')
        .every((request) => request.headers['traceparent'] === undefined),
    ).toBe(true);
  });
});
