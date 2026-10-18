import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { openMcpSession } from '../client/session.js';
import { admitHttpEndpoint, constructStreamableHttpTransport } from '../client/transport.js';

import type { IMCPSession } from '../client/session.js';

const VERSION = '2026-07-28';
const CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
const UI_EXTENSION = { 'io.modelcontextprotocol/ui': {} };
const UI_DECLARATION = { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } };
const VIEW_URI = 'ui://dash/view';
const VIEW_CONTENTS = [
  { uri: VIEW_URI, mimeType: 'text/html;profile=mcp-app', text: '<html></html>' },
];

interface IRecordedRequest {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

const requests: IRecordedRequest[] = [];
let listener: ReturnType<typeof createServer> | undefined;
let session: IMCPSession | undefined;

interface IFixtureOptions {
  readonly apps?: boolean;
  readonly skills?: boolean;
  readonly capabilities: Record<string, unknown>;
  /** What `resources/read` answers with; `ttlMs` makes the SDK's response cache applicable. */
  readonly readResult?: Record<string, unknown>;
}

async function open(options: IFixtureOptions): Promise<IMCPSession> {
  listener = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const message = JSON.parse(text) as {
      id: number;
      method: string;
      params: Record<string, unknown>;
    };
    requests.push({ method: message.method, params: message.params });
    const base = { resultType: 'complete', ttlMs: 0, cacheScope: 'private' };
    let result: Record<string, unknown>;
    if (message.method === 'server/discover') {
      result = { ...base, supportedVersions: [VERSION], capabilities: options.capabilities };
    } else if (message.method === 'tools/list') {
      result = {
        ...base,
        tools: [
          {
            name: 'dashboard',
            inputSchema: { type: 'object', properties: {} },
            _meta: { ui: { resourceUri: VIEW_URI } },
          },
        ],
      };
    } else if (message.method === 'resources/list') {
      result = { ...base, resources: [] };
    } else {
      result = { ...base, contents: VIEW_CONTENTS, ...options.readResult };
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  await new Promise<void>((resolve) => listener!.listen(0, '127.0.0.1', resolve));
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  const admitted = await admitHttpEndpoint(
    { url: `http://127.0.0.1:${address.port}` },
    { policy: { allowedHosts: ['127.0.0.1'] } },
  );
  if (!admitted.ok) throw new Error(admitted.reason);
  session = await openMcpSession({
    serverId: 'fixture',
    protocolVersion: VERSION,
    transport: constructStreamableHttpTransport(admitted.admitted),
    timeouts: { startupMs: 5_000, perCallMs: 5_000 },
    ...(options.apps === undefined ? {} : { apps: options.apps }),
    ...(options.skills === undefined ? {} : { skills: options.skills }),
  });
  return session;
}

function declaredByEveryRequest(): unknown[] {
  return requests.map((request) => {
    const meta = request.params['_meta'] as Record<string, unknown>;
    return meta[CLIENT_CAPABILITIES];
  });
}

afterEach(async () => {
  await session?.close();
  session = undefined;
  await new Promise<void>((resolve) => (listener ? listener.close(() => resolve()) : resolve()));
  listener = undefined;
  requests.length = 0;
});

describe('pinned session — MCP Apps negotiation', () => {
  it('declares no extensions on any request without the host opt-in', async () => {
    const opened = await open({ capabilities: { tools: {}, resources: {}, extensions: UI_EXTENSION } });
    await opened.discover({ maxPages: 2, perRequestTimeoutMs: 5_000 });
    expect(requests.map((request) => request.method)).toEqual(['server/discover', 'tools/list', 'resources/list']);
    for (const declared of declaredByEveryRequest()) {
      expect(declared).toEqual({});
      expect(declared).not.toHaveProperty('extensions');
    }
  });

  it('declares the exact UI extension on every request with the opt-in', async () => {
    const opened = await open({
      apps: true,
      capabilities: { tools: {}, resources: {}, extensions: UI_EXTENSION },
    });
    await opened.discover({ maxPages: 2, perRequestTimeoutMs: 5_000 });
    expect(requests.length).toBeGreaterThanOrEqual(3);
    for (const declared of declaredByEveryRequest()) {
      expect(declared).toEqual({ extensions: UI_DECLARATION });
    }
  });

  it('keeps a tool view reference only when both sides declared the extension and the server declared resources', async () => {
    const opened = await open({
      apps: true,
      capabilities: { tools: {}, resources: {}, extensions: UI_EXTENSION },
    });
    expect(opened.apps).toBe(true);
    const discovery = await opened.discover({ maxPages: 2, perRequestTimeoutMs: 5_000 });
    const found = discovery.tools.items[0];
    expect(found?.ui).toEqual({ resourceUri: VIEW_URI, visibility: ['model', 'app'] });
    expect(found).not.toHaveProperty('_meta');
  });

  it.each([
    ['the host did not opt in', false, { tools: {}, resources: {}, extensions: UI_EXTENSION }],
    ['the server declared no extension', true, { tools: {}, resources: {} }],
    ['the server declared no resources', true, { tools: {}, extensions: UI_EXTENSION }],
  ] as const)('drops the view reference when %s', async (_label, apps, capabilities) => {
    const opened = await open({ apps, capabilities });
    expect(opened.apps).toBeUndefined();
    const discovery = await opened.discover({ maxPages: 2, perRequestTimeoutMs: 5_000 });
    expect(discovery.tools.items[0]).toBeDefined();
    expect(discovery.tools.items[0]).not.toHaveProperty('ui');
    expect(discovery.tools.items[0]).not.toHaveProperty('uiProblem');
  });

  it('merges the UI declaration with the Skills extension a host selected', async () => {
    const opened = await open({
      apps: true,
      skills: true,
      capabilities: {
        tools: {},
        resources: {},
        extensions: { ...UI_EXTENSION, 'io.modelcontextprotocol/skills': {} },
      },
    });
    expect(opened.apps).toBe(true);
    expect(opened.skills).toBeDefined();
    expect(declaredByEveryRequest()).toEqual([{ extensions: UI_DECLARATION }]);
  });

  it('says honestly which extension the surface offers', async () => {
    const withApps = await open({ apps: true, capabilities: { tools: {}, resources: {} } });
    const reasonWithApps = withApps.compatibilityDiagnostics?.find(
      (diagnostic) => diagnostic.capability === 'extensions',
    )?.reason;
    expect(reasonWithApps).toContain('UI extension');
    expect(reasonWithApps).not.toContain('No optional extension');
    await withApps.close();
    await new Promise<void>((resolve) => listener!.close(() => resolve()));

    const without = await open({ capabilities: { tools: {}, resources: {} } });
    expect(
      without.compatibilityDiagnostics?.find((diagnostic) => diagnostic.capability === 'extensions')
        ?.reason,
    ).toBe('No optional extension is offered or activated by this surface.');
  });
});

describe('pinned session — readResource', () => {
  it('reads through the carrier and hands back the contents', async () => {
    const opened = await open({
      apps: true,
      capabilities: { tools: {}, resources: {}, extensions: UI_EXTENSION },
    });
    const result = await opened.readResource(VIEW_URI);
    expect(result).toEqual({ contents: VIEW_CONTENTS });
    const reads = requests.filter((request) => request.method === 'resources/read');
    expect(reads).toHaveLength(1);
    expect(reads[0]?.params['uri']).toBe(VIEW_URI);
  });

  it('never serves a view from the response cache', async () => {
    const opened = await open({
      capabilities: { tools: {}, resources: {} },
      readResult: { ttlMs: 600_000, cacheScope: 'public' },
    });
    await opened.readResource(VIEW_URI);
    await opened.readResource(VIEW_URI);
    expect(requests.filter((request) => request.method === 'resources/read')).toHaveLength(2);
  });

  it('refuses without sending anything when the server did not declare resources', async () => {
    const opened = await open({ apps: true, capabilities: { tools: {}, extensions: UI_EXTENSION } });
    const before = requests.length;
    await expect(opened.readResource(VIEW_URI)).rejects.toThrow('did not declare resources');
    expect(requests).toHaveLength(before);
  });
});
