/**
 * One in-process host that serves both protocol eras (the official v2 server handler), reached by
 * `openMcpSession` over the package's own admitted transport: once with legacy negotiation, once
 * with the explicit 2026-07-28 revision. The same client code completes discovery and `tools/call`
 * in both, and the wire shows exactly the verbs each era needs.
 */
import { createServer } from 'node:http';

import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, Server } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';

import { MCPAuthenticationError } from '../client/authentication.js';
import { MCPSessionError, openMcpSession } from '../client/session.js';
import {
  MCPTransportRedirectRefusedError,
  admitHttpEndpoint,
  constructStreamableHttpTransport,
} from '../client/transport.js';
import { classifyMcpFailure } from '../supervisor/connection.js';

import type { IMCPSession } from '../client/session.js';
import type { IMCPHttpEndpoint } from '../client/transport.js';
import type { Tool } from '@modelcontextprotocol/server';
import type { ServerResponse } from 'node:http';

const tool = {
  name: 'echo',
  description: 'Echo a value',
  inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
} as Tool;

interface IWireRequest {
  readonly method: string;
  readonly protocolVersionHeader?: string;
}

let listener: ReturnType<typeof createServer> | undefined;
let session: IMCPSession | undefined;
const wire: IWireRequest[] = [];

type TCallHandler = (request: {
  readonly params: { readonly name: string; readonly arguments?: Record<string, unknown> };
}) => Promise<{
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
}>;

const echoCall: TCallHandler = async (request) => ({
  content: [{ type: 'text', text: `echo:${String(request.params.arguments?.['value'])}` }],
});

async function startHost(tools: Tool[] = [tool], call: TCallHandler = echoCall): Promise<string> {
  const handler = createMcpHandler(
    () => {
      const server = new Server(
        { name: 'dual-era-host', version: '1.2.3' },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler('tools/list', async () => ({ tools }));
      server.setRequestHandler('tools/call', call);
      return server;
    },
    { maxSubscriptions: 0 },
  );
  const nodeHandler = toNodeHandler(handler);
  listener = createServer((request, response) => {
    void (async () => {
      let parsed: unknown;
      if (request.method === 'POST') {
        let text = '';
        for await (const chunk of request) text += chunk;
        parsed = JSON.parse(text);
        const protocolVersionHeader = request.headers['mcp-protocol-version'];
        wire.push({
          method: (parsed as { method: string }).method,
          ...(typeof protocolVersionHeader === 'string' ? { protocolVersionHeader } : {}),
        });
      }
      await nodeHandler(request, response, parsed);
    })();
  });
  await new Promise<void>((resolve) => listener!.listen(0, '127.0.0.1', resolve));
  const address = listener!.address();
  if (!address || typeof address === 'string') throw new Error('Missing listener');
  return `http://127.0.0.1:${address.port}`;
}

/** A host outside the v2 handler that answers every request the same way; records the methods it saw. */
async function startRawHost(
  answer: (message: { id: number; method: string }, response: ServerResponse) => void,
): Promise<string> {
  listener = createServer((request, response) => {
    void (async () => {
      let text = '';
      for await (const chunk of request) text += chunk;
      const message = JSON.parse(text) as { id: number; method: string };
      wire.push({ method: message.method });
      answer(message, response);
    })();
  });
  await new Promise<void>((resolve) => listener!.listen(0, '127.0.0.1', resolve));
  const address = listener!.address();
  if (!address || typeof address === 'string') throw new Error('Missing listener');
  return `http://127.0.0.1:${address.port}`;
}

async function open(
  url: string,
  protocolVersion?: string,
  endpoint: Omit<IMCPHttpEndpoint, 'url'> = {},
): Promise<IMCPSession> {
  const admitted = await admitHttpEndpoint(
    { url, ...endpoint },
    { policy: { allowedHosts: ['127.0.0.1'] } },
  );
  if (!admitted.ok) throw new Error(admitted.reason);
  session = await openMcpSession({
    serverId: 'dual-era',
    ...(protocolVersion === undefined ? {} : { protocolVersion }),
    transport: constructStreamableHttpTransport(admitted.admitted),
    timeouts: { startupMs: 3_000, perCallMs: 3_000 },
  });
  return session;
}

afterEach(async () => {
  await session?.close();
  session = undefined;
  await new Promise<void>((resolve) => (listener ? listener.close(() => resolve()) : resolve()));
  listener = undefined;
  wire.length = 0;
});

describe('one client for both protocol eras', () => {
  it('connects in legacy mode, discovers and completes tools/call', async () => {
    const client = await open(await startHost());
    expect(client.identity).toMatchObject({
      serverName: 'dual-era-host',
      serverVersion: '1.2.3',
      protocolVersion: '2025-11-25',
    });
    expect(
      (await client.discover({ maxPages: 2, perRequestTimeoutMs: 3_000 })).tools.items,
    ).toEqual([expect.objectContaining({ name: 'echo' })]);
    expect(await client.callTool('echo', { value: 'legacy' })).toMatchObject({
      content: [{ type: 'text', text: 'echo:legacy' }],
      isError: false,
    });
    const methods = wire.map((request) => request.method);
    expect(methods[0]).toBe('initialize');
    expect(methods).toContain('notifications/initialized');
    expect(methods).not.toContain('server/discover');
    expect(wire.some((request) => request.protocolVersionHeader === '2026-07-28')).toBe(false);
  });

  it("refuses structured content that violates the tool's declared output schema on the legacy era", async () => {
    const typed = {
      name: 'typed',
      description: 'Typed output',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
    } as Tool;
    const url = await startHost([tool, typed], async (request) =>
      request.params.name === 'typed'
        ? {
            content: [{ type: 'text', text: 'typed' }],
            structuredContent: { n: request.params.arguments?.['n'] },
          }
        : echoCall(request),
    );
    const client = await open(url);
    await client.discover({ maxPages: 2, perRequestTimeoutMs: 3_000 });
    expect(await client.callTool('typed', { n: 1 })).toMatchObject({
      structuredContent: { n: 1 },
      isError: false,
    });
    const error = await client.callTool('typed', { n: 'not-a-number' }).catch(
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/output schema/);
    expect(classifyMcpFailure(error)).toBe('config');
  });

  it('connects with the explicit 2026-07-28 revision and completes tools/call', async () => {
    const client = await open(await startHost(), '2026-07-28');
    expect(client.identity).toMatchObject({
      serverName: 'dual-era-host',
      serverVersion: '1.2.3',
      protocolVersion: '2026-07-28',
      catalogGeneration: expect.any(String),
    });
    expect(
      (await client.discover({ maxPages: 2, perRequestTimeoutMs: 3_000 })).tools.items,
    ).toEqual([expect.objectContaining({ name: 'echo' })]);
    expect(await client.callTool('echo', { value: 'modern' })).toMatchObject({
      content: [{ type: 'text', text: 'echo:modern' }],
      isError: false,
    });
    // Only the verbs the pinned era needs: no initialize handshake and no ping.
    expect(wire.map((request) => request.method)).toEqual([
      'server/discover',
      'tools/list',
      'tools/call',
    ]);
    expect(wire.every((request) => request.protocolVersionHeader === '2026-07-28')).toBe(true);
  });

  it('never falls back to the legacy handshake when the server only speaks the legacy era', async () => {
    const url = await startRawHost((message, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'Method not found' },
        }),
      );
    });
    await expect(open(url, '2026-07-28')).rejects.toMatchObject({
      kind: 'unsupported-protocol-version',
    });
    expect(wire.map((request) => request.method)).toEqual(['server/discover']);
  });

  it('still reads a legacy server refusing the probe over HTTP 400 as not offering the revision', async () => {
    const url = await startRawHost((message, response) => {
      response.writeHead(400, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32000, message: 'Bad Request: Server not initialized' },
        }),
      );
    });
    await expect(open(url, '2026-07-28')).rejects.toMatchObject({
      kind: 'unsupported-protocol-version',
    });
  });

  it('reports a non-protocol HTTP error from the pinned probe by its status, not as a missing revision', async () => {
    const url = await startRawHost((_message, response) => {
      response.writeHead(404, { 'content-type': 'text/html' }).end('<html>Not Found</html>');
    });
    const error = await open(url, '2026-07-28').catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(MCPSessionError);
    expect(error).toMatchObject({ kind: 'initialize-failed', details: { status: 404 } });
    expect(classifyMcpFailure(error)).toBe('not-found');
  });

  it("surfaces the carrier's refused credential from the pinned probe, not a retried negotiation failure", async () => {
    const url = await startRawHost((_message, response) => {
      response.writeHead(401, { 'www-authenticate': 'Bearer realm="mcp"' }).end();
    });
    const authentication = {
      serverId: 'dual-era',
      securityIdentity: 'sid-dual-era',
      authenticator: {
        authorize: async () => ({ authorization: 'Bearer refused' }),
        onRejected: async () => 'fail' as const,
      },
    };
    const error = await open(url, '2026-07-28', { authentication }).catch(
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(MCPAuthenticationError);
    expect(classifyMcpFailure(error)).toBe('auth');
    // The refusal is final: nothing is sent again, neither by the carrier nor by the negotiation.
    expect(wire.map((request) => request.method)).toEqual(['server/discover']);
  });

  it("keeps a redirect during the pinned probe as the carrier's own refusal", async () => {
    const url = await startRawHost((_message, response) => {
      response.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' }).end();
    });
    const error = await open(url, '2026-07-28').catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(MCPTransportRedirectRefusedError);
    expect(classifyMcpFailure(error)).toBe('config');
  });

  it('keeps an unreachable pinned server transient rather than reading it as an unsupported revision', async () => {
    listener = createServer();
    await new Promise<void>((resolve) => listener!.listen(0, '127.0.0.1', resolve));
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('Missing listener');
    await new Promise<void>((resolve) => listener!.close(() => resolve()));
    listener = undefined;
    const error = await open(`http://127.0.0.1:${address.port}`, '2026-07-28').catch(
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toMatchObject({ kind: 'unsupported-protocol-version' });
    expect(classifyMcpFailure(error)).toBe('transient');
  });
});
