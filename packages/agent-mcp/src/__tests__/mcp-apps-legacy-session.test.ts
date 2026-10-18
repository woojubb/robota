import { afterEach, describe, expect, it } from 'vitest';

import { startMockMcpServer } from './mock-mcp-server.js';
import { openMcpSession } from '../client/session.js';
import { admitHttpEndpoint, constructStreamableHttpTransport } from '../client/transport.js';

import type { IMockCapabilities, IMockMcpServer, IMockTool } from './mock-mcp-server.js';
import type { IMCPSession } from '../client/session.js';
import type { IEgressPolicy } from '@robota-sdk/agent-core/node';

const LOOPBACK_POLICY: IEgressPolicy = { allowedHosts: ['127.0.0.1'] };
const UI_EXTENSION = { 'io.modelcontextprotocol/ui': {} };
const UI_DECLARATION = { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } };
const VIEW_URI = 'ui://dash/view';
const VIEW_TOOL: IMockTool = {
  name: 'dashboard',
  inputSchema: { type: 'object', properties: {} },
  _meta: { ui: { resourceUri: VIEW_URI }, 'ui/resourceUri': 'ui://deprecated/ignored' },
};
const VIEW_CONTENTS = {
  [VIEW_URI]: [{ uri: VIEW_URI, mimeType: 'text/html;profile=mcp-app', text: '<html></html>' }],
};

let server: IMockMcpServer | undefined;
let session: IMCPSession | undefined;

afterEach(async () => {
  await session?.close();
  session = undefined;
  await server?.close();
  server = undefined;
});

async function open(
  mockServer: IMockMcpServer,
  options: { apps?: boolean } = {},
): Promise<IMCPSession> {
  const admission = await admitHttpEndpoint({ url: mockServer.url }, { policy: LOOPBACK_POLICY });
  if (!admission.ok) throw new Error(`test setup: admission refused: ${admission.reason}`);
  session = await openMcpSession({
    serverId: 'mock-server',
    transport: constructStreamableHttpTransport(admission.admitted),
    timeouts: { startupMs: 2_000, perCallMs: 2_000 },
    ...(options.apps === undefined ? {} : { apps: options.apps }),
  });
  return session;
}

function initializeCapabilities(mockServer: IMockMcpServer): Record<string, unknown> {
  const initialize = mockServer.requests.find((request) => request.body?.['method'] === 'initialize');
  return (initialize?.body?.['params'] as { capabilities: Record<string, unknown> }).capabilities;
}

async function serverWith(capabilities: IMockCapabilities): Promise<IMockMcpServer> {
  server = await startMockMcpServer({
    capabilities,
    tools: [VIEW_TOOL],
    resources: [{ uri: VIEW_URI, name: 'dashboard' }],
    resourceContents: VIEW_CONTENTS,
  });
  return server;
}

describe('legacy session — MCP Apps negotiation', () => {
  it('sends no extensions key at all without the host opt-in', async () => {
    const mock = await serverWith({ tools: {}, resources: {}, extensions: UI_EXTENSION });
    await open(mock);
    expect(initializeCapabilities(mock)).toEqual({});
    expect(initializeCapabilities(mock)).not.toHaveProperty('extensions');
  });

  it('declares the exact UI extension with the opt-in', async () => {
    const mock = await serverWith({ tools: {}, resources: {}, extensions: UI_EXTENSION });
    await open(mock, { apps: true });
    expect(initializeCapabilities(mock)).toEqual({ extensions: UI_DECLARATION });
  });

  it('sends no extensions key when the host passes apps: false', async () => {
    const mock = await serverWith({ tools: {} });
    await open(mock, { apps: false });
    expect(initializeCapabilities(mock)).toEqual({});
  });

  it('keeps a tool view reference only when both sides declared the extension and the server declared resources', async () => {
    const mock = await serverWith({ tools: {}, resources: {}, extensions: UI_EXTENSION });
    const opened = await open(mock, { apps: true });
    expect(opened.apps).toBe(true);
    const discovery = await opened.discover({ maxPages: 2, perRequestTimeoutMs: 2_000 });
    const found = discovery.tools.items.find((item) => item.name === 'dashboard');
    expect(found?.ui).toEqual({ resourceUri: VIEW_URI, visibility: ['model', 'app'] });
    // The raw metadata never rides along, and the deprecated flat key is not read.
    expect(found).not.toHaveProperty('_meta');
    expect(JSON.stringify(found)).not.toContain('deprecated');
  });

  it.each([
    ['the host did not opt in', false, { tools: {}, resources: {}, extensions: UI_EXTENSION }],
    ['the server declared no extension', true, { tools: {}, resources: {} }],
    [
      'the server declared another extension only',
      true,
      { tools: {}, resources: {}, extensions: { 'io.modelcontextprotocol/skills': {} } },
    ],
    ['the server declared no resources', true, { tools: {}, extensions: UI_EXTENSION }],
  ] as const)('drops the view reference when %s', async (_label, apps, capabilities) => {
    const mock = await serverWith(capabilities);
    const opened = await open(mock, { apps });
    expect(opened.apps).toBeUndefined();
    const discovery = await opened.discover({ maxPages: 2, perRequestTimeoutMs: 2_000 });
    const found = discovery.tools.items.find((item) => item.name === 'dashboard');
    expect(found).toBeDefined();
    expect(found).not.toHaveProperty('ui');
    expect(found).not.toHaveProperty('uiProblem');
  });

  it('reports a malformed declaration as a problem, only where views are negotiated', async () => {
    const broken: IMockTool = {
      name: 'broken',
      inputSchema: { type: 'object', properties: {} },
      _meta: { ui: { resourceUri: 'https://example.com/not-ui' } },
    };
    server = await startMockMcpServer({
      capabilities: { tools: {}, resources: {}, extensions: UI_EXTENSION },
      tools: [broken],
    });
    const negotiated = await open(server, { apps: true });
    const negotiatedTool = (
      await negotiated.discover({ maxPages: 2, perRequestTimeoutMs: 2_000 })
    ).tools.items[0];
    expect(negotiatedTool).toMatchObject({ name: 'broken', uiProblem: 'invalid-uri' });
    expect(negotiatedTool).not.toHaveProperty('ui');

    await negotiated.close();
    const plain = await open(server);
    const plainTool = (await plain.discover({ maxPages: 2, perRequestTimeoutMs: 2_000 })).tools
      .items[0];
    expect(plainTool).not.toHaveProperty('uiProblem');
    expect(plainTool).not.toHaveProperty('ui');
  });
});

describe('legacy session — readResource', () => {
  it('reads the requested resource and hands back its contents', async () => {
    const mock = await serverWith({ tools: {}, resources: {}, extensions: UI_EXTENSION });
    const opened = await open(mock, { apps: true });
    const result = await opened.readResource(VIEW_URI);
    expect(result).toEqual({ contents: VIEW_CONTENTS[VIEW_URI] });
    const reads = mock.requests.filter((request) => request.body?.['method'] === 'resources/read');
    expect(reads).toHaveLength(1);
    expect(reads[0]?.body?.['params']).toEqual({ uri: VIEW_URI });
  });

  it('works for any declared resource, not only a negotiated view', async () => {
    const mock = await serverWith({ tools: {}, resources: {} });
    const opened = await open(mock);
    expect(opened.apps).toBeUndefined();
    await expect(opened.readResource(VIEW_URI)).resolves.toMatchObject({
      contents: [{ uri: VIEW_URI }],
    });
  });

  it('refuses without sending anything when the server did not declare resources', async () => {
    const mock = await serverWith({ tools: {} });
    const opened = await open(mock, { apps: true });
    const before = mock.requests.length;
    await expect(opened.readResource(VIEW_URI)).rejects.toThrow('did not declare resources');
    expect(mock.requests).toHaveLength(before);
  });

  it('fails the read when the server does not know the resource', async () => {
    const mock = await serverWith({ tools: {}, resources: {} });
    const opened = await open(mock);
    await expect(opened.readResource('ui://dash/unknown')).rejects.toThrow();
  });

  it('stops waiting when the caller aborts', async () => {
    const mock = await serverWith({ tools: {}, resources: {} });
    const opened = await open(mock);
    const controller = new AbortController();
    controller.abort();
    await expect(opened.readResource(VIEW_URI, { signal: controller.signal })).rejects.toThrow();
  });
});
