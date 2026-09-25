/**
 * End to end through the real session wrapper chain: a prompt whose host trusts an MCP server's
 * exact origin sends that server a `traceparent` on the tool call, and the span it names as parent
 * is the tool span the prompt's trace exports.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { InteractiveSession } from '@robota-sdk/agent-framework';
import {
  MCPConnectionSupervisor,
  admitHttpEndpoint,
  buildCatalog,
  constructStreamableHttpTransport,
  createDiscoveredTool,
  openMcpSession,
} from '@robota-sdk/agent-mcp';

import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';
import type { IMCPCatalogToolEntry } from '@robota-sdk/agent-mcp';
import type { IncomingHttpHeaders, Server } from 'node:http';

interface IFakeServer {
  readonly url: string;
  readonly origin: string;
  readonly toolCalls: IncomingHttpHeaders[];
  readonly others: IncomingHttpHeaders[];
  close(): Promise<void>;
}

async function startFakeMcpServer(): Promise<IFakeServer> {
  const toolCalls: IncomingHttpHeaders[] = [];
  const others: IncomingHttpHeaders[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    req.on('end', () => {
      if (req.method !== 'POST') return void res.writeHead(405).end();
      const rpc = JSON.parse(raw) as { id?: unknown; method?: string };
      if (rpc.method === 'tools/call') toolCalls.push({ ...req.headers });
      else others.push({ ...req.headers });
      if (rpc.method?.startsWith('notifications/')) return void res.writeHead(202).end();
      const result =
        rpc.method === 'initialize'
          ? {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'fake', version: '1.0.0' },
            }
          : rpc.method === 'tools/list'
            ? { tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: {} } }] }
            : { content: [{ type: 'text', text: 'echoed' }], isError: false };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    url: `${origin}/mcp`,
    origin,
    toolCalls,
    others,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('MCP HTTP trace propagation through a real session', () => {
  let home: string;
  let server: IFakeServer;
  let supervisor: MCPConnectionSupervisor;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'robota-mcp-traceparent-'));
    vi.stubEnv('HOME', home);
    server = await startFakeMcpServer();
    const admission = await admitHttpEndpoint(
      { url: server.url },
      { policy: { allowedHosts: ['127.0.0.1'] } },
    );
    if (!admission.ok) throw new Error('fake MCP endpoint was not admitted');
    const endpoint = admission.admitted;
    supervisor = new MCPConnectionSupervisor({
      serverId: 'fake',
      openSession: (signal) =>
        openMcpSession({
          serverId: 'fake',
          transport: constructStreamableHttpTransport(endpoint),
          timeouts: { startupMs: 2_000, perCallMs: 2_000 },
          signal,
        }),
      timeouts: { startupMs: 2_000, perCallMs: 2_000, globalDefaultMs: 5_000, idleMs: 60_000, toolCallMs: 2_000 },
    });
  });

  afterEach(async () => {
    await supervisor.shutdown();
    await server.close();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  async function toolEntry(): Promise<IMCPCatalogToolEntry> {
    const discovery = await supervisor.discover();
    const entry = buildCatalog([
      { serverId: 'fake', origin: 'test-fixture', transport: 'streamable-http', discovery },
    ]).adopted.find((candidate) => candidate.kind === 'tool');
    if (!entry || entry.kind !== 'tool') throw new Error('the fake tool was not adopted');
    return entry;
  }

  async function runPrompt(allowedOrigins: string[]): Promise<ILivePromptTraceBatch> {
    const entry = await toolEntry();
    const scripted = createScriptedProvider([
      { toolCalls: [{ name: entry.canonicalName, args: {} }] },
      { text: 'done' },
    ]);
    const enqueue = vi.fn();
    const session = new InteractiveSession({
      cwd: home,
      provider: scripted.provider,
      bare: true,
      permissionMode: 'bypassPermissions',
      additionalTools: [createDiscoveredTool(entry, supervisor)],
      maxTurns: 3,
      livePromptTrace: { enqueue, traceContextPropagation: { allowedOrigins } },
    });
    try {
      const handle = await session.submit('call the MCP tool');
      await handle.completed;
    } finally {
      await session.shutdown();
    }
    expect(enqueue).toHaveBeenCalledOnce();
    return enqueue.mock.calls[0]![0] as ILivePromptTraceBatch;
  }

  it('names the exported tool span as the parent of the MCP tool call', async () => {
    const batch = await runPrompt([server.origin]);

    expect(server.toolCalls).toHaveLength(1);
    const traceparent = server.toolCalls[0]!['traceparent'];
    expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    const [, traceId, spanId] = String(traceparent).split('-');
    const tools = batch.children.flatMap((child) => (child.kind === 'tool' ? [child.trace] : []));
    expect(tools).toHaveLength(1);
    expect(batch.root.traceId).toBe(traceId);
    expect(tools[0]!.traceId).toBe(traceId);
    expect(tools[0]!.spanId).toBe(spanId);
    expect(server.others.every((headers) => headers['traceparent'] === undefined)).toBe(true);
  });

  it('sends nothing when the MCP server origin is not listed', async () => {
    await runPrompt(['https://api.example.com']);
    expect(server.toolCalls).toHaveLength(1);
    expect(server.toolCalls[0]!['traceparent']).toBeUndefined();
  });
});
