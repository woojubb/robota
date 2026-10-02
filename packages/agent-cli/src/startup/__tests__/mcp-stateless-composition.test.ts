import { createServer } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import {
  decodeSource,
  materializeDefinition,
  InMemoryMCPActivationApprovalStore,
  MCPDefinitionRegistry,
} from '@robota-sdk/agent-mcp';
import { createMcpClientComposition } from '../mcp-client-composition.js';
import type { IMcpClientComposition } from '../mcp-client-composition.js';

let listener: ReturnType<typeof createServer> | undefined;
let composition: IMcpClientComposition | undefined;
const methods: string[] = [];
const metadata: unknown[] = [];
const headers: { protocol?: string; session?: string }[] = [];
let effects = 0;

async function fixture() {
  listener = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const message = JSON.parse(text);
    methods.push(message.method);
    metadata.push(message.params?._meta);
    headers.push({ protocol: request.headers['mcp-protocol-version'] as string, session: request.headers['mcp-session-id'] as string });
    response.setHeader('content-type', 'application/json');
    if (request.headers.authorization !== 'Bearer renewed-fixture') {
      response.writeHead(401, { 'www-authenticate': 'Bearer realm="fixture"' }).end();
      return;
    }
    if (message.method === 'initialize') {
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'Requires stateless discovery' } }));
      return;
    }
    const common = { resultType: 'complete', ttlMs: 0, cacheScope: 'private', _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'modern-fixture', version: '1' } } };
    const result = message.method === 'server/discover'
      ? { ...common, supportedVersions: ['2026-07-28'], capabilities: { tools: {} } }
      : message.method === 'tools/list'
        ? { ...common, tools: [{ name: 'observe', inputSchema: { type: 'object' }, outputSchema: { type: 'number' } }] }
        : { ...common, content: [{ type: 'text', text: 'observed once' }], structuredContent: ++effects };
    response.setHeader('mcp-session-id', 'unsolicited-old-session');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  await new Promise<void>((resolve) => listener!.listen(0, '127.0.0.1', resolve));
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  const decoded = decodeSource({ mcpServers: { modern: { type: 'http', url: `http://127.0.0.1:${address.port}`, protocolVersion: '2026-07-28' } } }, 'user', 'fixture-settings');
  expect(decoded.problems).toEqual([]);
  return decoded.definitions.map((definition) => ({ name: definition.name, source: definition.source, origin: definition.origin, status: 'resolved' as const, definition: materializeDefinition(definition, {}), shadowed: [] }));
}

afterEach(async () => {
  await composition?.shutdown();
  composition = undefined;
  await new Promise<void>((resolve) => listener ? listener.close(() => resolve()) : resolve());
  listener = undefined;
  methods.length = 0;
  metadata.length = 0;
  headers.length = 0;
  effects = 0;
});

it('connects the selected stateless peer through product composition with bounded authentication and typed scalar output', async () => {
  const entries = await fixture();
  const store = new InMemoryMCPActivationApprovalStore();
  for (const request of new MCPDefinitionRegistry(entries).list()) store.put({ ...request, approvalAuthority: 'user', decision: 'approved', decidedAt: new Date(0).toISOString() });
  let fresh = false;
  let rejected = 0;
  const diagnostics: string[] = [];
  composition = createMcpClientComposition({
    resolvedEntries: entries,
    approvalStore: store,
    transport: { policy: { allowedHosts: ['127.0.0.1'] } },
    timeouts: { startupMs: 1000, perCallMs: 1000, globalDefaultMs: 1000, toolCallMs: 1000, idleMs: 10000 },
    authenticatorFor: () => ({
      authorize: async () => ({ Authorization: `Bearer ${fresh ? 'renewed' : 'initial'}-fixture` }),
      onRejected: async () => { fresh = true; rejected++; return 'retry'; },
    }),
    reportDiagnostic: (message) => diagnostics.push(message),
  });
  const tools = await composition.connect();
  expect(tools).toHaveLength(1);
  const result = await tools[0]!.execute({}, { toolName: tools[0]!.getName(), parameters: {} });
  expect(result.success).toBe(true);
  expect(JSON.stringify(result)).toContain('observed once');
  expect(effects).toBe(1);
  expect(rejected).toBe(1);
  expect(methods).toEqual(['server/discover', 'server/discover', 'tools/list', 'tools/call']);
  for (let i = 0; i < methods.length; i++) {
    expect(metadata[i]).toMatchObject({ 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} });
    expect(headers[i]).toEqual({ protocol: '2026-07-28', session: undefined });
  }
  expect(diagnostics.join(' ')).toMatch(/input_required.*unavailable/);
});

it('does not let protocol selection grant activation approval or dispatch a request', async () => {
  const entries = await fixture();
  composition = createMcpClientComposition({ resolvedEntries: entries, transport: { policy: { allowedHosts: ['127.0.0.1'] } }, reportDiagnostic: () => undefined });
  expect(await composition.connect()).toEqual([]);
  expect(methods).toEqual([]);
  expect(effects).toBe(0);
});

it('refuses an approval made for the legacy definition after the protocol choice changes', async () => {
  const entries = await fixture();
  const legacyEntries = entries.map((entry) => {
    const { protocolVersion: _version, ...definition } = entry.definition;
    return { ...entry, definition };
  });
  const store = new InMemoryMCPActivationApprovalStore();
  for (const request of new MCPDefinitionRegistry(legacyEntries).list()) store.put({ ...request, approvalAuthority: 'user', decision: 'approved', decidedAt: new Date(0).toISOString() });
  const diagnostics: string[] = [];
  composition = createMcpClientComposition({ resolvedEntries: entries, approvalStore: store, transport: { policy: { allowedHosts: ['127.0.0.1'] } }, reportDiagnostic: (message) => diagnostics.push(message) });
  expect(await composition.connect()).toEqual([]);
  expect(methods).toEqual([]);
  expect(diagnostics.join(' ')).toMatch(/stale/);
});
