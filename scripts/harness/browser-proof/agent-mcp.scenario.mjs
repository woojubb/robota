/**
 * agent-mcp in a web-only realm: a Streamable HTTP client that initialises against a server the
 * `fetch` stub plays, lists its tools and calls one. The host passes the web egress on purpose;
 * `./node` has the one that resolves addresses, and the main entry has no default.
 */
import {
  admitHttpEndpoint,
  constructStreamableHttpTransport,
  createStreamableHttpAdapter,
  createWebFetchEgress,
  openMcpSession,
} from '@robota-sdk/agent-mcp';

import { jsonResponse } from './kit.mjs';

const URL_OF_SERVER = 'https://mcp.example.com/mcp';

/** The server: answers each JSON-RPC request the way a Streamable HTTP MCP server does. */
function serve(record) {
  const rpc = JSON.parse(record.body || 'null');
  if (record.method === 'GET') return new Response(null, { status: 405 });
  if (record.method !== 'POST' || rpc === null) return new Response(null, { status: 405 });
  if (rpc.id === undefined) return new Response(null, { status: 202 });
  const result = {
    initialize: {
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'proof-server', version: '1.0.0' },
    },
    'tools/list': {
      tools: [
        {
          name: 'echo',
          description: 'Returns its arguments',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        },
      ],
    },
    'tools/call': {
      content: [{ type: 'text', text: JSON.stringify(rpc.params?.arguments ?? {}) }],
      isError: false,
    },
  }[rpc.method];
  return jsonResponse(
    result === undefined
      ? { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `no ${rpc.method}` } }
      : { jsonrpc: '2.0', id: rpc.id, result },
  );
}

export default async function mcp(t) {
  t.fetch.on(URL_OF_SERVER, serve);
  const methods = () =>
    t.fetch.requests
      .filter((request) => request.body)
      .map((request) => JSON.parse(request.body).method);

  // With no egress a call is refused before anything is sent: the entry has no default network.
  const refused = await createStreamableHttpAdapter().admit({ url: URL_OF_SERVER });
  t.equal(
    'no egress, no request: admission is refused',
    [refused.ok, refused.reason, t.fetch.requests.length],
    [false, 'egress-unavailable', 0],
  );

  const egress = createWebFetchEgress();
  const admission = await admitHttpEndpoint({ url: URL_OF_SERVER }, { egress });
  t.ok('the web egress admits a public https endpoint', admission.ok, admission.reason);
  const session = await openMcpSession({
    serverId: 'proof',
    transport: constructStreamableHttpTransport(admission.admitted),
    timeouts: { startupMs: 2_000, perCallMs: 2_000 },
  });
  try {
    t.equal('the server named itself at initialize', session.identity, {
      serverId: 'proof',
      serverName: 'proof-server',
      serverVersion: '1.0.0',
      protocolVersion: '2025-03-26',
    });
    const initialize = t.fetch.requests.find((request) => request.body.includes('"initialize"'));
    t.equal(
      'the client POSTs JSON-RPC to the admitted URL',
      [initialize?.method, initialize?.url],
      ['POST', URL_OF_SERVER],
    );
    t.match(
      'the client accepts a JSON or an event-stream reply',
      initialize?.headers.accept ?? '',
      'text/event-stream',
    );

    const discovery = await session.discover({ maxPages: 2, perRequestTimeoutMs: 2_000 });
    t.equal(
      "discovery lists the server's tool",
      discovery.tools.items.map((tool) => tool.name),
      ['echo'],
    );

    const call = await session.callTool('echo', { text: 'hello' });
    t.equal(
      "a tool call returns the server's content",
      [call.isError, call.content],
      [false, [{ type: 'text', text: '{"text":"hello"}' }]],
    );
    t.equal(
      'the protocol ran in order: initialize, initialized, list, call',
      methods().filter((method, index, all) => all.indexOf(method) === index),
      ['initialize', 'notifications/initialized', 'tools/list', 'tools/call'],
    );
  } finally {
    await session.close();
  }
}
