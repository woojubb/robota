import { runTransportLifecycleConformance } from '@robota-sdk/agent-interface-transport/testing';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { PassThrough } from 'node:stream';

import { describe, it, expect, expectTypeOf } from 'vitest';
import { createMcpTransport } from '../mcp-transport.js';
import type { IMcpTransportSession } from '../mcp-session.js';
import type { IMcpTransport } from '../mcp-transport.js';
import type { ITransportAdapter } from '@robota-sdk/agent-interface-transport';

function createMockSession(): IMcpTransportSession {
  const full = createTestInteractiveSession();
  return {
    submit: full.submit,
    listRuntimeTools: full.listRuntimeTools,
    invokeRuntimeTool: full.invokeRuntimeTool,
  };
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
