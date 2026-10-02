import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { openMcpSession, type IMCPSession } from '../client/session.js';
import { admitHttpEndpoint, constructStreamableHttpTransport } from '../client/transport.js';
import { createStdioAdapter } from '../client/stdio.js';
import { MCPActivationAdmissionService } from '../mcp-activation.js';
import { MCPDefinitionRegistry } from '../definition/registry.js';
import { catalogIdentityOf, sameCatalogIdentity } from '../catalog/types.js';
import { classifyMcpFailure } from '../supervisor/connection.js';

const version = '2026-07-28';
const requests: {
  method: string;
  params: Record<string, unknown>;
  header?: string;
  session?: string;
}[] = [];
let session: IMCPSession | undefined;
let listener: ReturnType<typeof createServer> | undefined;

async function openModern(
  change: (
    method: string,
    result: Record<string, unknown>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>> = (_method, result) => result,
) {
  listener = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const message = JSON.parse(body) as {
      id: number;
      method: string;
      params: Record<string, unknown>;
    };
    requests.push({
      method: message.method,
      params: message.params,
      header: request.headers['mcp-protocol-version'] as string | undefined,
      session: request.headers['mcp-session-id'] as string | undefined,
    });
    response.setHeader('content-type', 'application/json');
    response.setHeader('mcp-session-id', 'ignored-legacy-session');
    if (message.method === 'notifications/cancelled') {
      response.writeHead(202).end();
      return;
    }
    const meta = message.params?._meta as Record<string, unknown> | undefined;
    if (
      meta?.['io.modelcontextprotocol/protocolVersion'] !== version ||
      message.method === 'initialize'
    ) {
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32600, message: 'Stateless request metadata required' },
        }),
      );
      return;
    }
    const common = {
      resultType: 'complete',
      ttlMs: 0,
      cacheScope: 'private',
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'stateless-fixture', version: '1' } },
    };
    let result: Record<string, unknown>;
    if (message.method === 'server/discover')
      result = {
        ...common,
        supportedVersions: [version],
        capabilities: { tools: {} },
        instructions: 'Untrusted fixture guidance',
      };
    else if (message.method === 'tools/list')
      result = {
        ...common,
        tools: [
          {
            name: 'echo',
            inputSchema: {
              type: 'object',
              properties: { value: { type: 'string' } },
              required: ['value'],
              additionalProperties: false,
            },
          },
        ],
      };
    else
      result = {
        ...common,
        content: [{ type: 'text', text: 'actual observation' }],
        structuredContent: { value: 'observed' },
      };
    response.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: await change(message.method, result),
      }),
    );
  });
  await new Promise<void>((resolve) => listener!.listen(0, '127.0.0.1', resolve));
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('Missing listener');
  const admitted = await admitHttpEndpoint(
    { url: `http://127.0.0.1:${address.port}` },
    { policy: { allowedHosts: ['127.0.0.1'] } },
  );
  if (!admitted.ok) throw new Error(admitted.reason);
  const options = {
    serverId: 'modern',
    protocolVersion: version,
    transport: constructStreamableHttpTransport(admitted.admitted),
    timeouts: { startupMs: 1000, perCallMs: 1000 },
    clientInfo: { name: 'fixture-client', version: '7' },
  };
  session = await openMcpSession(options);
  return session;
}

afterEach(async () => {
  await session?.close();
  session = undefined;
  await new Promise<void>((resolve) => (listener ? listener.close(() => resolve()) : resolve()));
  listener = undefined;
  requests.length = 0;
});

describe('explicit stateless MCP session', () => {
  it('uses self-contained server discovery, lists and calls without a legacy handshake/session', async () => {
    const client = await openModern();
    const discovery = await client.discover({ maxPages: 2, perRequestTimeoutMs: 1000 });
    expect(client.identity).toMatchObject({
      serverId: 'modern',
      serverName: 'stateless-fixture',
      serverVersion: '1',
      protocolVersion: version,
      catalogGeneration: expect.any(String),
    });
    expect(client.discoveryCacheHint).toMatchObject({
      ttlMs: 0,
      cacheScope: 'private',
      receivedAtMs: expect.any(Number),
    });
    expect(discovery.tools.cacheHints).toEqual([
      { ttlMs: 0, cacheScope: 'private', receivedAtMs: expect.any(Number) },
    ]);
    expect(discovery.tools.items.map((tool) => tool.name)).toEqual(['echo']);
    const result = await client.callTool('echo', { value: 'input' });
    expect(result).toMatchObject({
      content: [{ type: 'text', text: 'actual observation' }],
      structuredContent: { value: 'observed' },
      isError: false,
    });
    expect(requests.map((request) => request.method)).toEqual([
      'server/discover',
      'tools/list',
      'tools/call',
    ]);
    for (const request of requests) {
      expect(request.params._meta).toEqual({
        'io.modelcontextprotocol/protocolVersion': version,
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': { name: 'fixture-client', version: '7' },
      });
      expect(request.header).toBe(version);
      expect(request.session).toBeUndefined();
    }
  });

  it('rejects a server that does not support the explicitly selected version without falling back', async () => {
    await expect(
      openModern((method, result) =>
        method === 'server/discover' ? { ...result, supportedVersions: ['2025-11-25'] } : result,
      ),
    ).rejects.toMatchObject({ kind: 'unsupported-protocol-version' });
    expect(requests.map((request) => request.method)).toEqual(['server/discover']);
  });

  it('accepts omitted optional serverInfo without claiming an external version or reusing another carrier catalog', async () => {
    const client = await openModern((_method, result) => ({ ...result, _meta: {} }));
    expect(client.identity).toMatchObject({
      serverName: 'modern',
      serverVersion: '',
      serverInfoProvided: false,
    });
    const first = catalogIdentityOf(client.identity);
    const later = catalogIdentityOf({ ...client.identity, catalogGeneration: 'different-carrier' });
    expect(sameCatalogIdentity(first, later)).toBe(false);
  });

  it('rejects malformed freshness metadata rather than treating discovery as an unlimited cache entry', async () => {
    await expect(openModern((_method, result) => ({ ...result, ttlMs: -1 }))).rejects.toThrow(
      /metadata/i,
    );
    expect(requests.map((request) => request.method)).toEqual(['server/discover']);
  });

  it('does not turn input_required into a completed tool result or retry the effect', async () => {
    const client = await openModern((method, result) =>
      method === 'tools/call' ? { ...result, resultType: 'input_required' } : result,
    );
    await expect(client.callTool('echo', { value: 'input' })).rejects.toThrow(
      /unsupported.*input_required/i,
    );
    await expect(client.callTool('echo', { value: 'input' })).rejects.toThrow(/closed/);
    expect(requests.filter((request) => request.method === 'tools/call')).toHaveLength(1);
  });

  it('rejects malformed tool results with a permanent, value-free error', async () => {
    const client = await openModern((method, result) =>
      method === 'tools/call' ? { ...result, content: 'malformed-credential-canary' } : result,
    );
    const error = await client.callTool('echo', {}).catch((error) => error);
    expect(error.message).toMatch(/invalid-tool-result/);
    expect(error.message).not.toContain('malformed-credential-canary');
    expect(classifyMcpFailure(error)).toBe('config');
    expect(client.compatibilityDiagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ capability: 'extensions' })]),
    );
    await expect(client.callTool('echo', {})).rejects.toThrow(/closed/);
  });

  it.each([null, 7, 'observed', true, ['observed']])(
    'preserves a completed structured JSON value: %j',
    async (structuredContent) => {
      const client = await openModern((method, result) =>
        method === 'tools/call' ? { ...result, structuredContent } : result,
      );
      expect((await client.callTool('echo', {})).structuredContent).toEqual(structuredContent);
    },
  );

  it('discovers non-object output schemas and boolean property schemas', async () => {
    const client = await openModern((method, result) =>
      method === 'tools/list'
        ? {
            ...result,
            tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { value: true } }, outputSchema: { type: 'string' } }],
          }
        : result,
    );
    const catalog = await client.discover({ maxPages: 2, perRequestTimeoutMs: 1000 });
    expect(catalog.tools.items[0]).toMatchObject({
      inputSchema: { type: 'object', properties: { value: true } },
      outputSchema: { type: 'string' },
    });
  });

  it('refuses a completed result missing required content', async () => {
    const client = await openModern((method, result) => {
      if (method !== 'tools/call') return result;
      const { content: _content, ...rest } = result;
      return rest;
    });
    await expect(client.callTool('echo', {})).rejects.toThrow(/invalid-tool-result/);
    await expect(client.callTool('echo', {})).rejects.toThrow(/closed/);
  });

  it('rejects invalid page metadata rather than returning a partial catalog', async () => {
    const client = await openModern((method, result) =>
      method === 'tools/list' ? { ...result, cacheScope: 'unknown' } : result,
    );
    await expect(client.discover({ maxPages: 2, perRequestTimeoutMs: 1000 })).rejects.toMatchObject(
      { failure: { kind: 'protocol', domain: 'tools' } },
    );
  });

  it('bounds startup even when an admitted transport never finishes starting', async () => {
    let closed = false;
    await expect(
      openMcpSession({
        serverId: 'hung',
        protocolVersion: version,
        timeouts: { startupMs: 20, perCallMs: 1000 },
        transport: {
          start: () => new Promise<void>(() => undefined),
          send: async () => undefined,
          close: async () => {
            closed = true;
          },
        },
      }),
    ).rejects.toMatchObject({ kind: 'startup-timeout' });
    expect(closed).toBe(true);
  });

  it('does not dispatch a pre-aborted tool call', async () => {
    const client = await openModern();
    const signal = AbortSignal.abort();
    await expect(client.callTool('echo', { value: 'input' }, { signal })).rejects.toThrow();
    expect(requests.filter((request) => request.method === 'tools/call')).toHaveLength(0);
  });

  it('closes after a deadline with unknown effects and never replays the call', async () => {
    let release: (() => void) | undefined;
    const client = await openModern((method, result) =>
      method === 'tools/call'
        ? new Promise((resolve) => {
            release = () => resolve(result);
          })
        : result,
    );
    try {
      await expect(
        client.callTool('echo', { value: 'input' }, { timeoutMs: 30 }),
      ).rejects.toThrow();
      await expect(client.callTool('echo', { value: 'input' })).rejects.toThrow(/closed/);
      expect(requests.filter((request) => request.method === 'tools/call')).toHaveLength(1);
    } finally {
      release?.();
    }
  });

  it('uses the same exact authority and closes a real stdio child after stateless discovery/calls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modern-mcp-stdio-'));
    const fixture = fileURLToPath(new URL('./fixtures/stateless-mcp-server.mjs', import.meta.url));
    const definition = {
      name: 'stdio-modern',
      source: 'project' as const,
      origin: 'fixture',
      transport: 'stdio' as const,
      command: process.execPath,
      args: [fixture],
      unsetVariables: [],
    };
    const activation = new MCPDefinitionRegistry(
      [
        {
          name: definition.name,
          source: definition.source,
          origin: definition.origin,
          status: 'resolved',
          definition,
          shadowed: [],
        },
      ],
      { workspace: { repositoryKey: root, trustState: 'trusted', generation: 1 } },
    ).list()[0]!;
    const admission = new MCPActivationAdmissionService();
    admission.approve(activation);
    const adapter = createStdioAdapter({
      admission,
      authority: {
        allowedRoot: root,
        generation: '1',
        executables: [{ command: process.execPath, args: [[fixture]] }],
        environment: { HOME: root },
      },
    });
    const admitted = await adapter.admit({ definition, activation });
    if (!admitted.ok) throw new Error(admitted.reason);
    const transport = adapter.construct(admitted.admitted);
    try {
      session = await openMcpSession({
        serverId: definition.name,
        protocolVersion: version,
        transport,
        timeouts: { startupMs: 3000, perCallMs: 3000 },
      });
      const discovery = await session.discover({ maxPages: 2, perRequestTimeoutMs: 3000 });
      expect(discovery.tools.items.map((tool) => tool.name)).toEqual(['echo']);
      const result = await session.callTool('echo', {});
      expect(result.content[0]?.text).toBe('server/discover,tools/list,tools/call');
      await session.close();
      session = undefined;
      expect('closedDirectChild' in transport && transport.closedDirectChild).toBe(true);
    } finally {
      await transport.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
