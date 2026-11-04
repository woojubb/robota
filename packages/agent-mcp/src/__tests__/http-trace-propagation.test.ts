/**
 * Trusted `traceparent` on MCP tool calls over Streamable HTTP.
 *
 * A tool call carrying outbound trace context sends `traceparent` on its own `tools/call` POST and
 * on the `notifications/cancelled` that cancels it — and on nothing else, even though the SDK keeps
 * running the call's response stream, and whatever it triggers, long after the call started.
 *
 * A cancelled call's own request is withdrawn too: on a legacy connection the SDK only sends
 * `notifications/cancelled`, and the transport closes the call's POST by the JSON-RPC id.
 */
import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { fixtureTimeouts } from './supervisor-test-helpers.js';
import { buildCatalog } from '../catalog/build.js';
import { createDiscoveredTool } from '../catalog/discovered-tool.js';
import { openMcpSession } from '../client/session.js';
import { createWebFetchEgress } from '../client/http-egress.js';
import {
  callRequestsOf,
  outboundTraceHeaders,
  type MCPCallRequests,
} from '../client/trace-propagation.js';
import { admitHttpEndpoint, constructStreamableHttpTransport } from '../client/transport.js';
import { createNodeHttpEgress } from '../node/http-egress.js';
import { MCPConnectionSupervisor } from '../supervisor/connection.js';

import type { IMCPCatalogToolEntry, IMCPDiscovery } from '../catalog/types.js';
import type { IMCPSession, IMCPToolCallResult } from '../client/session.js';
import type { Transport } from '@modelcontextprotocol/client';
import type { IOutboundTraceContext } from '@robota-sdk/agent-core';
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const traceparent = (span: string): string => `00-${TRACE_ID}-${span}-01`;
const SPAN_A = 'a1a1a1a1a1a1a1a1';
const SPAN_B = 'b2b2b2b2b2b2b2b2';

interface IRecorded {
  readonly httpMethod: string;
  readonly rpc: Record<string, unknown> | undefined;
  readonly headers: IncomingHttpHeaders;
}

type TToolsCallHandler = (rpc: Record<string, unknown>, res: ServerResponse) => void;

interface IFakeServer {
  readonly url: string;
  readonly origin: string;
  readonly port: number;
  readonly requests: IRecorded[];
  /** Resolves once a POST with this JSON-RPC method has been received `count` times. */
  received(method: string, count?: number): Promise<IRecorded[]>;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')));
    req.on('end', () => resolve(data));
  });
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function toolResult(id: unknown, text: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: false } };
}

/** A minimal Streamable HTTP MCP server: JSON for everything but `tools/call`, which the test drives. */
async function startFakeServer(onToolsCall?: TToolsCallHandler): Promise<IFakeServer> {
  const requests: IRecorded[] = [];
  const waiters: Array<() => void> = [];
  const open = new Set<ServerResponse>();
  const server: Server = createServer((req, res) => {
    void (async () => {
      const raw = await readBody(req);
      let rpc: Record<string, unknown> | undefined;
      try {
        rpc = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
      } catch {
        rpc = undefined;
      }
      requests.push({ httpMethod: req.method ?? '', rpc, headers: { ...req.headers } });
      for (const wake of waiters.splice(0)) wake();
      if (req.method === 'GET') return void res.writeHead(405).end();
      if (req.method === 'DELETE') return void res.writeHead(204).end();
      const method = rpc?.['method'];
      const id = rpc?.['id'];
      if (method === 'initialize') {
        return sendJson(res, {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: 'fake', version: '1.0.0' },
          },
        });
      }
      if (typeof method === 'string' && method.startsWith('notifications/')) {
        return void res.writeHead(202).end();
      }
      if (method === 'tools/list') {
        return sendJson(res, {
          jsonrpc: '2.0',
          id,
          result: { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }] },
        });
      }
      if (method === 'tools/call' && rpc) {
        open.add(res);
        res.on('close', () => open.delete(res));
        if (onToolsCall) return onToolsCall(rpc, res);
        return sendJson(res, toolResult(id, 'ok'));
      }
      sendJson(res, { jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown' } });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const origin = `http://127.0.0.1:${address.port}`;
  const matching = (method: string) =>
    requests.filter((request) => request.httpMethod === 'POST' && request.rpc?.['method'] === method);
  return {
    url: `${origin}/mcp`,
    origin,
    port: address.port,
    requests,
    async received(method, count = 1) {
      while (matching(method).length < count) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      return matching(method);
    },
    async close() {
      for (const res of open) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const ADMISSION_HEADERS = { 'x-tenant': 'acme' } as const;

async function admitted(server: IFakeServer) {
  const admission = await admitHttpEndpoint(
    { url: server.url, headers: ADMISSION_HEADERS },
    { egress: createNodeHttpEgress({ policy: { allowedHosts: ['127.0.0.1'] } }) },
  );
  if (!admission.ok) throw new Error('test MCP endpoint admission failed');
  return admission.admitted;
}

async function openSession(
  server: IFakeServer,
): Promise<{ session: IMCPSession; transport: Transport; registry: MCPCallRequests }> {
  const endpoint = await admitted(server);
  const transport = constructStreamableHttpTransport(endpoint);
  const session = await openMcpSession({
    serverId: 'traced',
    transport,
    timeouts: { startupMs: 2_000, perCallMs: 2_000 },
  });
  const registry = callRequestsOf(transport);
  if (!registry) throw new Error('an HTTP transport must track its calls');
  return { session, transport, registry };
}

function outbound(server: IFakeServer, span: string, origins = [server.origin]): IOutboundTraceContext {
  return { traceparent: traceparent(span), allowedOrigins: origins };
}

function withoutTraceparent(requests: readonly IRecorded[]): boolean {
  return requests.every((request) => request.headers['traceparent'] === undefined);
}

describe('traceparent on MCP HTTP tool calls', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function serve(onToolsCall?: TToolsCallHandler): Promise<IFakeServer> {
    const server = await startFakeServer(onToolsCall);
    cleanups.push(() => server.close());
    return server;
  }

  async function sessionFor(server: IFakeServer) {
    const opened = await openSession(server);
    cleanups.push(() => opened.session.close());
    return opened;
  }

  it.each(['abort', 'timeout'] as const)(
    'withdraws the request of a call cancelled by %s on a legacy connection while an independent call stays live',
    async (mode) => {
      let cancelledClosed = false;
      const held = new Map<string, { rpc: Record<string, unknown>; res: ServerResponse }>();
      const server = await serve((rpc, res) => {
        const text = (rpc['params'] as { arguments: { text: string } }).arguments.text;
        held.set(text, { rpc, res });
        if (text === 'cancel')
          res.once('close', () => {
            cancelledClosed = true;
          });
      });
      const { session, registry } = await sessionFor(server);
      const controller = new AbortController();
      const cancelled = session.callTool(
        'echo',
        { text: 'cancel' },
        { signal: controller.signal, timeoutMs: mode === 'timeout' ? 1000 : 5000 },
      );
      const rejected = expect(cancelled).rejects.toBeDefined();
      const independent = session
        .callTool('echo', { text: 'independent' }, { timeoutMs: 5000 })
        .then(
          (result) => ({ result }),
          (error: unknown) => ({ error }),
        );
      await server.received('tools/call', 2);
      if (mode === 'abort') controller.abort();
      await rejected;
      await expect.poll(() => cancelledClosed, { timeout: 1000 }).toBe(true);
      const live = held.get('independent')!;
      sendJson(live.res, toolResult(live.rpc['id'], 'independent success'));
      expect(await independent).toMatchObject({
        result: { content: [{ type: 'text', text: 'independent success' }] },
      });
      await server.received('notifications/cancelled');
      expect(registry.size).toBe(0);
      expect(withoutTraceparent(server.requests)).toBe(true);
    },
  );


  it('sends the call\'s traceparent on its tools/call only, beside the admission headers', async () => {
    const server = await serve();
    const { session, registry } = await sessionFor(server);
    const endpoint = await admitted(server);

    await session.callTool('echo', {}, { outboundTraceContext: outbound(server, SPAN_A) });
    await session.discover({ maxPages: 1, perRequestTimeoutMs: 2_000 });

    const [call] = await server.received('tools/call');
    expect(call!.headers['traceparent']).toBe(traceparent(SPAN_A));
    expect(call!.headers['x-tenant']).toBe('acme');
    const others = server.requests.filter((request) => request !== call);
    expect(others.length).toBeGreaterThan(0);
    expect(withoutTraceparent(others)).toBe(true);
    for (const request of server.requests.filter((r) => r.httpMethod === 'POST')) {
      expect(request.headers['x-tenant']).toBe('acme');
    }
    expect(endpoint.headers).toEqual(ADMISSION_HEADERS);
    expect(registry.size).toBe(0);
  });

  it('sends nothing to an origin that is not exactly listed', async () => {
    const server = await serve();
    const { session } = await sessionFor(server);
    for (const origins of [
      [`http://127.0.0.1:${server.port + 1}`],
      [`http://localhost:${server.port}`],
      [`https://127.0.0.1:${server.port}`],
      [],
    ]) {
      await session.callTool('echo', {}, { outboundTraceContext: outbound(server, SPAN_A, origins) });
    }
    await session.callTool('echo', {});
    expect(await server.received('tools/call', 5)).toHaveLength(5);
    expect(withoutTraceparent(server.requests)).toBe(true);
  });

  it('keeps the header off a tools/list refresh that list_changed triggers mid-stream', async () => {
    let server!: IFakeServer;
    server = await serve((rpc, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const listChanged = { jsonrpc: '2.0', method: 'notifications/tools/list_changed' };
      res.write(`event: message\ndata: ${JSON.stringify(listChanged)}\n\n`);
      // The result is held until the refresh the notification triggered has arrived.
      void server.received('tools/list', 2).then(() => {
        res.write(`event: message\ndata: ${JSON.stringify(toolResult(rpc['id'], 'ok'))}\n\n`);
        res.end();
      });
    });
    const endpoint = await admitted(server);
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'traced',
      openSession: (signal) =>
        openMcpSession({
          serverId: 'traced',
          transport: constructStreamableHttpTransport(endpoint),
          timeouts: { startupMs: 2_000, perCallMs: 2_000 },
          signal,
        }),
      timeouts: fixtureTimeouts(),
    });
    cleanups.push(() => supervisor.shutdown());
    await supervisor.discover();

    await supervisor.callTool('echo', {}, { outboundTraceContext: outbound(server, SPAN_A) });

    const [call] = await server.received('tools/call');
    expect(call!.headers['traceparent']).toBe(traceparent(SPAN_A));
    const lists = await server.received('tools/list', 2);
    const refresh = lists[1]!;
    expect(server.requests.indexOf(refresh)).toBeGreaterThan(server.requests.indexOf(call!));
    expect(refresh.headers['traceparent']).toBeUndefined();
    expect(withoutTraceparent(server.requests.filter((request) => request !== call))).toBe(true);
  });

  it('gives each of two concurrent calls its own header', async () => {
    const held: Array<{ rpc: Record<string, unknown>; res: ServerResponse }> = [];
    const server = await serve((rpc, res) => {
      held.push({ rpc, res });
      if (held.length === 2) {
        for (const call of held) sendJson(call.res, toolResult(call.rpc['id'], 'ok'));
      }
    });
    const { session, registry } = await sessionFor(server);

    await Promise.all([
      session.callTool('echo', { text: 'a' }, { outboundTraceContext: outbound(server, SPAN_A) }),
      session.callTool('echo', { text: 'b' }, { outboundTraceContext: outbound(server, SPAN_B) }),
    ]);

    const calls = await server.received('tools/call', 2);
    const byText = new Map(
      calls.map((call) => [
        (call.rpc?.['params'] as { arguments: { text: string } }).arguments.text,
        call.headers['traceparent'],
      ]),
    );
    expect(byText.get('a')).toBe(traceparent(SPAN_A));
    expect(byText.get('b')).toBe(traceparent(SPAN_B));
    expect(registry.size).toBe(0);
  });

  it('sends the call\'s header on the cancellation an external abort issues', async () => {
    const server = await serve(() => undefined);
    const { session, registry } = await sessionFor(server);
    const abort = new AbortController();

    const pending = session.callTool('echo', {}, {
      signal: abort.signal,
      outboundTraceContext: outbound(server, SPAN_A),
    });
    const [call] = await server.received('tools/call');
    expect(registry.size).toBe(1);
    abort.abort();
    await expect(pending).rejects.toThrow();

    const [cancel] = await server.received('notifications/cancelled');
    expect((cancel!.rpc?.['params'] as { requestId: unknown }).requestId).toBe(call!.rpc?.['id']);
    expect(cancel!.headers['traceparent']).toBe(traceparent(SPAN_A));
    expect(registry.size).toBe(0);
  });

  it.each([
    ['abort', 'the stream ends with no event'],
    ['timeout', 'the stream ends with no event'],
    ['abort', 'a priming event, a dropped stream and a refused reconnect'],
  ] as const)(
    "repeats the header on the %s of a call whose stream ended unanswered (%s)",
    async (mode, shape) => {
      const server = await serve((_rpc, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (shape.startsWith('a priming')) res.write('id: e1\ndata: \n\n');
        res.end();
      });
      const { session, registry } = await sessionFor(server);
      const controller = new AbortController();

      const pending = session.callTool('echo', {}, {
        signal: controller.signal,
        timeoutMs: mode === 'timeout' ? 400 : 8_000,
        outboundTraceContext: outbound(server, SPAN_A),
      });
      const rejected = expect(pending).rejects.toThrow();
      const [call] = await server.received('tools/call');
      if (mode === 'abort') {
        // Let the stream end, and for the priming event let the reconnect it asks for be refused.
        if (shape.startsWith('a priming')) {
          await expect
            .poll(() => server.requests.some((r) => r.headers['last-event-id'] === 'e1'), {
              timeout: 4_000,
            })
            .toBe(true);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
        controller.abort();
      }
      await rejected;

      const [cancel] = await server.received('notifications/cancelled');
      expect((cancel!.rpc?.['params'] as { requestId: unknown }).requestId).toBe(call!.rpc?.['id']);
      expect(cancel!.headers['traceparent']).toBe(traceparent(SPAN_A));
      expect(registry.size).toBe(0);
    },
  );

  it('stops tracking a call whose server answers with the id in string form', async () => {
    const server = await serve((rpc, res) => {
      sendJson(res, toolResult(String(rpc['id']), 'ok'));
    });
    const { session, registry } = await sessionFor(server);

    const result = await session.callTool('echo', {}, { timeoutMs: 2_000 });

    expect(result.isError).toBe(false);
    expect(registry.size).toBe(0);
  });

  it('sends the call\'s header on the cancellation a timeout issues', async () => {
    const server = await serve(() => undefined);
    const { session, registry } = await sessionFor(server);

    await expect(
      session.callTool('echo', {}, { timeoutMs: 50, outboundTraceContext: outbound(server, SPAN_B) }),
    ).rejects.toThrow();

    const [call] = await server.received('tools/call');
    const [cancel] = await server.received('notifications/cancelled');
    expect((cancel!.rpc?.['params'] as { requestId: unknown }).requestId).toBe(call!.rpc?.['id']);
    expect(cancel!.headers['traceparent']).toBe(traceparent(SPAN_B));
    expect(registry.size).toBe(0);
  });

  it('leaves no entry behind when the session under a pending call closes and a new one opens', async () => {
    let holdFirst = true;
    const server = await serve((rpc, res) => {
      if (holdFirst) {
        holdFirst = false;
        return;
      }
      sendJson(res, toolResult(rpc['id'], 'ok'));
    });
    const first = await openSession(server);
    const pending = first.session.callTool('echo', {}, { outboundTraceContext: outbound(server, SPAN_A) });
    await server.received('tools/call');
    expect(first.registry.size).toBe(1);
    const rejected = expect(pending).rejects.toThrow();
    await first.session.close();
    await rejected;
    expect(first.registry.size).toBe(0);

    const second = await sessionFor(server);
    await second.session.callTool('echo', {}, { outboundTraceContext: outbound(server, SPAN_B) });
    const calls = await server.received('tools/call', 2);
    expect(calls[1]!.headers['traceparent']).toBe(traceparent(SPAN_B));
    expect(second.registry.size).toBe(0);
    expect(first.registry.size).toBe(0);
  });

  it('offers a header only for an exactly listed origin, and none for a transport that is not HTTP', async () => {
    const endpoint = {
      kind: 'streamable-http' as const,
      url: new URL('https://mcp.example.com/mcp'),
      headers: {},
      egress: createWebFetchEgress(async () => new Response(null, { status: 202 })),
    };
    const transport = constructStreamableHttpTransport(endpoint);
    const context = (origin: string): IOutboundTraceContext => ({
      traceparent: traceparent(SPAN_A),
      allowedOrigins: [origin],
    });
    expect(outboundTraceHeaders(transport, context('https://mcp.example.com'))).toEqual({
      traceparent: traceparent(SPAN_A),
    });
    for (const origin of [
      'https://other.example.com',
      'http://mcp.example.com',
      'https://mcp.example.com:8443',
      'https://sub.mcp.example.com',
    ]) {
      expect(outboundTraceHeaders(transport, context(origin))).toEqual({});
    }
    expect(outboundTraceHeaders({}, context('https://mcp.example.com'))).toBeUndefined();
    await transport.close();
  });

  it("puts a header only on the request it was given for, repeats it on that call's cancellation, and adds nothing else", async () => {
    const seen: Array<{ method: unknown; traceparent: string | null }> = [];
    const endpoint = {
      kind: 'streamable-http' as const,
      url: new URL('https://mcp.example.com/mcp'),
      headers: {},
      egress: createWebFetchEgress(async (_input, init) => {
        seen.push({
          method: JSON.parse(String(init?.body))['method'],
          traceparent: new Headers(init?.headers).get('traceparent'),
        });
        return new Response(null, { status: 202 });
      }),
    };
    const transport = constructStreamableHttpTransport(endpoint);
    const calls = callRequestsOf(transport)!;
    const cancel = (requestId: number) => ({
      jsonrpc: '2.0' as const,
      method: 'notifications/cancelled' as const,
      params: { requestId },
    });

    await transport.send(
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'echo' } },
      { headers: { traceparent: traceparent(SPAN_A) } },
    );
    await transport.send({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'echo' } });
    await transport.send({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} });
    expect(calls.size).toBe(2);
    await transport.send(cancel(99));
    await transport.send(cancel(8));
    await transport.send(cancel(7));

    expect(seen).toEqual([
      { method: 'tools/call', traceparent: traceparent(SPAN_A) },
      { method: 'tools/call', traceparent: null },
      { method: 'tools/list', traceparent: null },
      { method: 'notifications/cancelled', traceparent: null },
      { method: 'notifications/cancelled', traceparent: null },
      { method: 'notifications/cancelled', traceparent: traceparent(SPAN_A) },
    ]);
    expect(calls.size).toBe(0);
    await transport.close();
  });

  it('stops tracking a call whose response arrives, and every call when the transport closes', async () => {
    const answers = new Map<number, Response>();
    const endpoint = {
      kind: 'streamable-http' as const,
      url: new URL('https://mcp.example.com/mcp'),
      headers: {},
      egress: createWebFetchEgress(async (_input, init) => {
        const id = JSON.parse(String(init?.body))['id'] as number;
        return answers.get(id) ?? new Response(null, { status: 202 });
      }),
    };
    const transport = constructStreamableHttpTransport(endpoint);
    const received: unknown[] = [];
    transport.onmessage = (message) => received.push(message);
    const calls = callRequestsOf(transport)!;
    answers.set(
      1,
      new Response(JSON.stringify(toolResult(1, 'ok')), {
        headers: { 'content-type': 'application/json' },
      }),
    );

    await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo' } });
    expect(received).toHaveLength(1);
    expect(calls.size).toBe(0);

    await transport.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo' } });
    await transport.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo' } });
    expect(calls.size).toBe(2);
    await transport.close();
    expect(calls.size).toBe(0);
  });
});

describe('outbound trace context through the MCP tool path', () => {
  function entry(): IMCPCatalogToolEntry {
    const discovery: IMCPDiscovery = {
      identity: { serverId: 'srv', serverName: 'srv', serverVersion: '1', protocolVersion: '2025-06-18' },
      tools: {
        state: { kind: 'supported', count: 1, listChanged: false },
        items: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }],
        pages: 1,
      },
      prompts: { state: { kind: 'unsupported' }, items: [], pages: 0 },
      resources: { state: { kind: 'unsupported' }, items: [], pages: 0 },
    };
    const found = buildCatalog([
      { serverId: 'srv', origin: 'test-fixture', transport: 'streamable-http', discovery },
    ]).adopted.find((candidate) => candidate.kind === 'tool');
    if (!found || found.kind !== 'tool') throw new Error('fixture setup failed');
    return found;
  }

  const ok: IMCPToolCallResult = { content: [{ type: 'text', text: 'ok' }], isError: false };

  it('hands the invoker exactly what it handed before when the body has no outbound context', async () => {
    const seen: unknown[] = [];
    const tool = createDiscoveredTool(entry(), {
      callTool: async (_name, _args, options) => {
        seen.push(options);
        return ok;
      },
    });
    const signal = new AbortController().signal;
    await tool.execute({}, { toolName: 'echo', parameters: {}, signal, toolBodyId: 'x' });
    await tool.execute({}, { toolName: 'echo', parameters: {} });
    expect(seen).toEqual([{ signal }, { signal: undefined }]);
    expect(seen.map((options) => Object.keys(options as object))).toEqual([['signal'], ['signal']]);
  });

  it('forwards the body\'s outbound context from the tool through the supervisor to the session', async () => {
    const context: IOutboundTraceContext = { traceparent: traceparent(SPAN_A), allowedOrigins: ['https://mcp.example.com'] };
    const sessionOptions: unknown[] = [];
    const { FakeMcpSession, fixtureIdentity } = await import('./supervisor-test-helpers.js');
    const supervisor = new MCPConnectionSupervisor({
      serverId: 'srv',
      openSession: async () =>
        new FakeMcpSession({
          identity: fixtureIdentity(),
          callTool: async (_name, _args, options) => {
            sessionOptions.push(options);
            return ok;
          },
        }),
      timeouts: fixtureTimeouts(),
    });
    try {
      const tool = createDiscoveredTool(entry(), supervisor);
      await tool.execute({}, { toolName: 'echo', parameters: {}, outboundTraceContext: context });
      await tool.execute({}, { toolName: 'echo', parameters: {} });
      expect(sessionOptions[0]).toMatchObject({ outboundTraceContext: context });
      expect(sessionOptions[1]).not.toHaveProperty('outboundTraceContext');
    } finally {
      await supervisor.shutdown();
    }
  });
});
