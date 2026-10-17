/**
 * A server's form-mode elicitation during `tools/call` becomes asks through the call's ask port, on
 * both protocol eras: a sessionful legacy host (the 1.x SDK) asks with a server→client
 * `elicitation/create`; the v2 host on 2026-07-28 answers with an `input_required` round the SDK
 * continues with `inputResponses`. Without the host opt-in nothing is declared and nothing is asked.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { toNodeHandler } from '@modelcontextprotocol/node';
import { Server as LegacyServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { acceptedContent, createMcpHandler, inputRequired, Server } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';

import { createDiscoveredTool } from '../catalog/discovered-tool.js';
import { openMcpSession } from '../client/session.js';
import { admitHttpEndpoint, constructStreamableHttpTransport } from '../client/transport.js';

import type { IMCPCatalogToolEntry } from '../catalog/types.js';
import type { IMCPSession, IMCPToolCallResult } from '../client/session.js';
import type { ElicitRequestFormParams } from '@modelcontextprotocol/client';
import type { ServerContext, Tool } from '@modelcontextprotocol/server';
import type { IActionRequest, TActionResponse } from '@robota-sdk/agent-core';
import type { IncomingMessage, ServerResponse } from 'node:http';

const PINNED = '2026-07-28';
const ERAS = ['legacy', PINNED] as const;
type TEra = (typeof ERAS)[number];

const confirmTool = {
  name: 'confirm',
  description: 'Asks before acting',
  inputSchema: { type: 'object', properties: {} },
} as Tool;

const requestedSchema: ElicitRequestFormParams['requestedSchema'] = {
  type: 'object',
  properties: {
    confirm: { type: 'boolean', title: 'Confirm deploy' },
    note: { type: 'string', title: 'Note', maxLength: 10 },
    color: {
      type: 'string',
      title: 'Color',
      oneOf: [
        { const: 'r', title: 'Red' },
        { const: 'g', title: 'Green' },
      ],
    },
  },
  required: ['confirm'],
};
const MESSAGE = 'Deploy to production?';

interface IWireRequest {
  readonly method: string;
  readonly params: Record<string, unknown> | undefined;
}

let listener: ReturnType<typeof createServer> | undefined;
let session: IMCPSession | undefined;
const wire: IWireRequest[] = [];
const legacyTransports = new Set<StreamableHTTPServerTransport>();

function recordWire(parsed: unknown): void {
  const message = parsed as { method?: string; params?: Record<string, unknown> };
  if (typeof message.method === 'string')
    wire.push({ method: message.method, params: message.params });
}

async function listen(
  handle: (request: IncomingMessage, response: ServerResponse, parsed: unknown) => Promise<void>,
): Promise<string> {
  listener = createServer((request, response) => {
    void (async () => {
      let parsed: unknown;
      if (request.method === 'POST') {
        let text = '';
        for await (const chunk of request) text += chunk;
        parsed = JSON.parse(text);
        recordWire(parsed);
      }
      await handle(request, response, parsed);
    })();
  });
  await new Promise<void>((resolve) => listener!.listen(0, '127.0.0.1', resolve));
  const address = listener!.address();
  if (!address || typeof address === 'string') throw new Error('Missing listener');
  return `http://127.0.0.1:${address.port}`;
}

/** The 2026-07-28 host: elicits with an `input_required` round, then echoes the answer. */
async function startModernHost(): Promise<string> {
  const handler = createMcpHandler(
    () => {
      const server = new Server(
        { name: 'eliciting-host', version: '1.0.0' },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler('tools/list', async () => ({ tools: [confirmTool] }));
      server.setRequestHandler('tools/call', (async (_request: unknown, ctx: ServerContext) => {
        const answer = ctx.mcpReq.inputResponses?.['ask'];
        if (answer === undefined)
          return inputRequired({
            inputRequests: { ask: inputRequired.elicit({ message: MESSAGE, requestedSchema }) },
            requestState: 'state-1',
          });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                answer,
                accepted: acceptedContent(ctx.mcpReq.inputResponses, 'ask'),
                requestState: ctx.mcpReq.requestState(),
              }),
            },
          ],
        };
      }) as never);
      return server;
    },
    { maxSubscriptions: 0 },
  );
  const nodeHandler = toNodeHandler(handler);
  return listen((request, response, parsed) => nodeHandler(request, response, parsed));
}

/**
 * The legacy host: one 1.x server per `Mcp-Session-Id`, so a server→client request can reach the
 * client over the call's stream and the client's answer can find its way back.
 */
async function startLegacyHost(
  elicitDuringList?: (server: LegacyServer) => Promise<void>,
): Promise<string> {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  return listen(async (request, response, parsed) => {
    const sessionId = request.headers['mcp-session-id'];
    let transport = typeof sessionId === 'string' ? transports.get(sessionId) : undefined;
    if (transport === undefined) {
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, created);
        },
      });
      legacyTransports.add(created);
      const server = new LegacyServer(
        { name: 'eliciting-host', version: '1.0.0' },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler(ListToolsRequestSchema, async () => {
        await elicitDuringList?.(server);
        return { tools: [confirmTool] };
      });
      server.setRequestHandler(CallToolRequestSchema, async () => {
        try {
          const answer = await server.elicitInput({ message: MESSAGE, requestedSchema });
          return { content: [{ type: 'text', text: JSON.stringify({ answer }) }] };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `elicit-failed:${(error as Error).message}` }],
            isError: true,
          };
        }
      });
      await server.connect(created);
      transport = created;
    }
    await transport.handleRequest(request, response, parsed);
  });
}

function startHost(era: TEra): Promise<string> {
  return era === PINNED ? startModernHost() : startLegacyHost();
}

async function open(url: string, era: TEra, elicitation: boolean): Promise<IMCPSession> {
  const admitted = await admitHttpEndpoint({ url }, { policy: { allowedHosts: ['127.0.0.1'] } });
  if (!admitted.ok) throw new Error(admitted.reason);
  session = await openMcpSession({
    serverId: 'eliciting',
    ...(era === PINNED ? { protocolVersion: PINNED } : {}),
    ...(elicitation ? { elicitation: true } : {}),
    transport: constructStreamableHttpTransport(admitted.admitted),
    timeouts: { startupMs: 3_000, perCallMs: 3_000 },
  });
  await session.discover({ maxPages: 2, perRequestTimeoutMs: 3_000 });
  return session;
}

/** An ask port answering from a script; records every request it was shown. */
function scriptedAsk(
  script: readonly (TActionResponse | ((request: IActionRequest) => TActionResponse))[],
) {
  const seen: IActionRequest[] = [];
  const queue = [...script];
  const ask = async (request: IActionRequest): Promise<TActionResponse> => {
    seen.push(request);
    const next = queue.shift();
    if (next === undefined) throw new Error(`No scripted answer for ask "${request.title}"`);
    return typeof next === 'function' ? next(request) : next;
  };
  return { ask, seen };
}

const answer = (value: string): TActionResponse => ({ type: 'answer', values: [value] });
const typed = (text: string): TActionResponse => ({ type: 'answer', values: [], text });

function echoed(result: IMCPToolCallResult): Record<string, unknown> {
  const text = result.content[0]?.['text'];
  if (typeof text !== 'string') throw new Error('No text content');
  return JSON.parse(text) as Record<string, unknown>;
}

/** What the client declared as its capabilities, as each era carries them. */
function declaredClientCapabilities(): unknown[] {
  return wire.flatMap((request) => {
    if (request.method === 'initialize') return [request.params?.['capabilities']];
    const meta = request.params?.['_meta'] as Record<string, unknown> | undefined;
    const declared = meta?.['io.modelcontextprotocol/clientCapabilities'];
    return declared === undefined ? [] : [declared];
  });
}

afterEach(async () => {
  await session?.close();
  session = undefined;
  for (const transport of legacyTransports) await transport.close().catch(() => undefined);
  legacyTransports.clear();
  await new Promise<void>((resolve) => (listener ? listener.close(() => resolve()) : resolve()));
  listener = undefined;
  wire.length = 0;
});

describe.each(ERAS)('elicitation bridge on the %s era', (era) => {
  it('turns a form elicitation during tools/call into asks and completes the call with the answers', async () => {
    const client = await open(await startHost(era), era, true);
    const { ask, seen } = scriptedAsk([
      answer('respond'),
      answer('yes'),
      typed('ship it'),
      answer('g'),
    ]);

    const result = await client.callTool('confirm', {}, { ask });

    expect(echoed(result)['answer']).toEqual({
      action: 'accept',
      content: { confirm: true, note: 'ship it', color: 'g' },
    });
    expect(result.isError).toBe(false);
    // Every prompt is titled with the server's identity; the server's text is the description.
    expect(seen[0]?.title).toContain('eliciting-host');
    expect(seen[0]?.description).toBe(MESSAGE);
    expect(seen[0]?.options?.map((option) => option.label)).toEqual(['Respond', 'Decline']);
    expect(seen[1]?.title).toContain('Confirm deploy');
    expect(seen[1]?.options?.map((option) => option.value)).toEqual(['yes', 'no']);
    expect(seen[2]).toMatchObject({ allowFreeText: true, allowEmpty: true });
    expect(seen[2]?.masked).not.toBe(true);
    expect(seen[3]?.options?.map((option) => option.label)).toEqual(
      expect.arrayContaining(['Red', 'Green']),
    );
    for (const request of seen) expect(request.title).toContain('eliciting-host');
    const declared = declaredClientCapabilities();
    expect(declared.length).toBeGreaterThan(0);
    for (const capabilities of declared)
      expect(capabilities).toMatchObject({ elicitation: { form: {} } });
    if (era === PINNED) {
      // The protocol's own continuation of the call: the second leg carries the answers and the
      // server's state; nothing else was sent twice.
      const calls = wire.filter((request) => request.method === 'tools/call');
      expect(calls).toHaveLength(2);
      expect(calls[0]?.params?.['inputResponses']).toBeUndefined();
      expect(calls[1]?.params).toMatchObject({
        requestState: 'state-1',
        inputResponses: { ask: { action: 'accept', content: { confirm: true } } },
      });
      expect(echoed(result)['requestState']).toBe('state-1');
    }
  });

  it('delivers a decline as a decline and a dismissal as a cancel', async () => {
    const client = await open(await startHost(era), era, true);
    const declined = await client.callTool(
      'confirm',
      {},
      { ask: scriptedAsk([answer('decline')]).ask },
    );
    expect(echoed(declined)['answer']).toEqual({ action: 'decline' });
    const cancelled = await client.callTool(
      'confirm',
      {},
      { ask: scriptedAsk([{ type: 'cancelled' }]).ask },
    );
    expect(echoed(cancelled)['answer']).toEqual({ action: 'cancel' });
    // Dismissing a field after Respond is a cancel too, never a partial accept.
    const midway = await client.callTool(
      'confirm',
      {},
      { ask: scriptedAsk([answer('respond'), { type: 'cancelled' }]).ask },
    );
    expect(echoed(midway)['answer']).toEqual({ action: 'cancel' });
  });

  it('re-asks once when an answer violates the field and sends the corrected value', async () => {
    const client = await open(await startHost(era), era, true);
    const { ask, seen } = scriptedAsk([
      answer('respond'),
      answer('no'),
      typed('far too long for ten'),
      typed('short'),
      answer('r'),
    ]);
    const result = await client.callTool('confirm', {}, { ask });
    expect(echoed(result)['answer']).toEqual({
      action: 'accept',
      content: { confirm: false, note: 'short', color: 'r' },
    });
    expect(seen).toHaveLength(5);
    expect(seen[3]?.description).toMatch(/at most 10/i);
  });

  it('declines when the call that is in flight has no ask port', async () => {
    const client = await open(await startHost(era), era, true);
    const result = await client.callTool('confirm', {});
    expect(echoed(result)['answer']).toEqual({ action: 'decline' });
  });

  it('declares no elicitation capability and asks nothing without the host opt-in', async () => {
    const client = await open(await startHost(era), era, false);
    const { ask, seen } = scriptedAsk([answer('respond')]);
    const outcome = await client.callTool('confirm', {}, { ask }).catch((error: unknown) => error);
    expect(seen).toEqual([]);
    const declared = declaredClientCapabilities();
    expect(declared.length).toBeGreaterThan(0);
    for (const capabilities of declared) expect(capabilities).not.toHaveProperty('elicitation');
    // Both SDK servers refuse to elicit from a client that declared nothing; the call fails and
    // nothing is asked. (A server that answers `input_required` regardless still closes the
    // carrier: `stateless-session.test.ts`.)
    if (era === PINNED) expect(outcome).toBeInstanceOf(Error);
    else {
      expect((outcome as IMCPToolCallResult).isError).toBe(true);
      expect((outcome as IMCPToolCallResult).content[0]?.['text']).toMatch(/elicit-failed/);
    }
  });
});

describe('elicitation outside a tool call', () => {
  it('declines a legacy request that arrives while no call is in flight', async () => {
    let listAnswer: unknown;
    const url = await startLegacyHost(async (server) => {
      listAnswer = await server
        .elicitInput({ message: 'Who are you?', requestedSchema: { type: 'object', properties: {} } })
        .catch((error: Error) => `failed:${error.message}`);
    });
    await open(url, 'legacy', true);
    expect(listAnswer).toEqual({ action: 'decline' });
  });
});

describe('the discovered tool hands its call the ask port', () => {
  const entry: IMCPCatalogToolEntry = {
    kind: 'tool',
    canonicalName: 'eliciting__confirm',
    sourceName: 'confirm',
    schema: { type: 'object', properties: {} },
    unenforceablePaths: [],
    provenance: {
      serverId: 'eliciting',
      serverName: 'eliciting-host',
      serverVersion: '1.0.0',
      protocolVersion: PINNED,
      origin: 'test',
    },
    disposition: 'adopted',
  };

  it('forwards context.ask to the invoker and omits it when the context has none', async () => {
    const received: unknown[] = [];
    const tool = createDiscoveredTool(entry, {
      callTool: async (_name, _args, options) => {
        received.push(options?.ask);
        return { content: [{ type: 'text', text: 'ok' }], isError: false };
      },
    });
    const ask = async (): Promise<TActionResponse> => ({ type: 'cancelled' });
    await tool.execute({}, { toolName: 'eliciting__confirm', parameters: {}, ask });
    await tool.execute({}, { toolName: 'eliciting__confirm', parameters: {} });
    expect(received).toEqual([ask, undefined]);
  });
});
