import { Client, ReadBuffer, serializeMessage } from '@modelcontextprotocol/client';
import { Server } from '@modelcontextprotocol/server';
import { runTransportLifecycleConformance } from '@robota-sdk/agent-interface-transport/testing';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { PassThrough } from 'node:stream';

import { describe, it, expect, expectTypeOf } from 'vitest';
import { createMcpTransport } from '../mcp-transport.js';
import type { IMcpTransportSession } from '../mcp-session.js';
import type { IMcpTransport } from '../mcp-transport.js';
import type { Transport } from '@modelcontextprotocol/client';
import type { ITransportAdapter } from '@robota-sdk/agent-interface-transport';
import type { Readable, Writable } from 'node:stream';

function createMockSession(): IMcpTransportSession {
  const full = createTestInteractiveSession();
  return {
    submit: full.submit,
    listRuntimeTools: full.listRuntimeTools,
    invokeRuntimeTool: full.invokeRuntimeTool,
  };
}

/** The peer's side of the carrier: a v2 client transport over the same two in-process streams. */
function createPeerTransport(serverOutput: Readable, serverInput: Writable): Transport {
  const buffer = new ReadBuffer();
  const transport: Transport = {
    async start() {
      serverOutput.on('data', (chunk: Buffer) => {
        buffer.append(chunk);
        for (;;) {
          const message = buffer.readMessage();
          if (message === null) return;
          transport.onmessage?.(message);
        }
      });
      serverOutput.once('end', () => transport.onclose?.());
    },
    async send(message) {
      serverInput.write(serializeMessage(message));
    },
    async close() {
      serverInput.end();
      transport.onclose?.();
    },
  };
  return transport;
}

describe('createMcpTransport', () => {
  it('requires exactly the MCP session port without a broad attach overload', () => {
    const transport = createMcpTransport({ name: 'test', version: '1.0.0' });
    expectTypeOf(transport).toMatchTypeOf<ITransportAdapter<IMcpTransportSession>>();
    expectTypeOf<IMcpTransport['attach']>().toEqualTypeOf<
      (session: IMcpTransportSession) => void
    >();
    expectTypeOf<IMcpTransportSession>().not.toHaveProperty('executeCommand');
    expect(Object.keys(createMockSession())).toHaveLength(3);
  });

  it('returns an adapter with name "mcp"', () => {
    const transport = createMcpTransport({ name: 'test', version: '1.0.0' });
    expect(transport.name).toBe('mcp');
  });

  it('throws if start() is called without attach()', async () => {
    const transport = createMcpTransport({ name: 'test', version: '1.0.0' });
    await expect(transport.start()).rejects.toMatchObject({
      name: 'TransportLifecycleError',
      code: 'not-attached',
    });
  });

  it('throws if getServer() is called before start()', () => {
    const transport = createMcpTransport({ name: 'test', version: '1.0.0' });
    expect(() => transport.getServer()).toThrow('Transport not started');
  });

  it('creates an MCP server after attach + start', async () => {
    const transport = createMcpTransport({
      name: 'test',
      version: '1.0.0',
      stdin: new PassThrough(),
      stdout: new PassThrough(),
    });
    transport.attach(createMockSession());
    await transport.start();
    const server = transport.getServer();
    expect(server).toBeDefined();
    expect(() => transport.attach(createMockSession())).toThrow('already-started');
    await transport.stop();
  });

  it('starts a serving stdio carrier and closes when its input ends', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const transport = createMcpTransport({ name: 'test', version: '1.0.0', stdin, stdout });
    transport.attach(createMockSession());
    await transport.start();
    const frame = new Promise<string>((resolve) => {
      stdout.once('data', (chunk: Buffer) => resolve(chunk.toString()));
    });
    stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test-peer', version: '1' },
        },
      }) + '\n',
    );
    expect(JSON.parse(await frame)).toMatchObject({
      id: 1,
      result: { serverInfo: { name: 'test' } },
    });
    stdin.end();
    await expect(transport.waitForClose()).resolves.toBeUndefined();
    await transport.stop();
    await transport.stop();
  });

  it('serves a v2 client over the carrier and carries a server-to-client elicitation', async () => {
    // #3470 depends on the stdio server reaching back into its client: unlike the v2 handler's
    // per-request legacy HTTP path, one stdio connection is stateful, so `elicitInput` has a
    // peer to ask. Asserted on the real carrier rather than an in-memory pair.
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const session = createMockSession();
    const transport = createMcpTransport({ name: 'test', version: '1.0.0', stdin, stdout });
    transport.attach({
      ...session,
      listRuntimeTools: async () => [
        {
          name: 'fixture_echo',
          description: 'Echo',
          parameters: { type: 'object' as const, properties: { text: { type: 'string' as const } } },
        },
      ],
      invokeRuntimeTool: async (name, parameters) => ({ success: true, name, parameters }),
    });
    await transport.start();
    expect(transport.getServer()).toBeInstanceOf(Server);
    const client = new Client(
      { name: 'peer', version: '1' },
      { capabilities: { elicitation: { form: {} } } },
    );
    const asked: string[] = [];
    client.setRequestHandler('elicitation/create', async (request) => {
      asked.push(request.params.message);
      return { action: 'accept', content: { name: 'robota' } };
    });
    try {
      await client.connect(createPeerTransport(stdout, stdin));
      expect(client.getProtocolEra()).toBe('legacy');
      expect(client.getServerCapabilities()).toEqual({ tools: {} });
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
        'fixture_echo',
        'agent_submit',
      ]);
      expect(await client.callTool({ name: 'fixture_echo', arguments: { text: 'hi' } })).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, name: 'fixture_echo', parameters: { text: 'hi' } }),
          },
        ],
        isError: false,
      });
      expect(transport.getServer().getClientCapabilities()).toEqual({ elicitation: { form: {} } });
      const answer = await transport.getServer().elicitInput({
        message: 'Who is asking?',
        requestedSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      });
      expect(answer).toEqual({ action: 'accept', content: { name: 'robota' } });
      expect(asked).toEqual(['Who is asking?']);
    } finally {
      await client.close();
      await transport.stop();
    }
  });

  it('surfaces a disconnected output pipe as a carrier failure', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const transport = createMcpTransport({ name: 'test', version: '1.0.0', stdin, stdout });
    transport.attach(createMockSession());
    await transport.start();
    stdout.destroy(new Error('output pipe closed'));
    await expect(transport.waitForClose()).rejects.toThrow('output pipe closed');
    await transport.stop();
  });

  it('cancels catalog validation when stdin closes before the carrier is ready', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const transport = createMcpTransport({ name: 'test', version: '1.0.0', stdin, stdout });
    transport.attach({
      ...createMockSession(),
      listRuntimeTools: () => new Promise<never>(() => {}),
    });
    const starting = transport.start();
    const rejected = expect(starting).rejects.toThrow('input closed during startup');
    stdin.end();
    await expect(transport.waitForClose()).resolves.toBeUndefined();
    await rejected;
    await transport.stop();
    expect(() => transport.getServer()).toThrow('Transport not started');
  });

  it('invokes the shared lifecycle conformance suite', async () => {
    await runTransportLifecycleConformance({
      subjectId: '@robota-sdk/agent-transport-mcp#createMcpTransport',
      kind: 'service',
      createAdapter: () => createMcpTransport({ name: 'conformance', version: '1.0.0' }),
      createSession: createMockSession,
      assertReady: (transport) => {
        transport.getServer();
      },
      assertStopped: (transport) => {
        expect(() => transport.getServer()).toThrow('Transport not started');
      },
    });
  });
});
