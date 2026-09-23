import { runTransportLifecycleConformance } from '@robota-sdk/agent-interface-transport/testing';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

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
    const transport = createMcpTransport({ name: 'test', version: '1.0.0' });
    transport.attach(createMockSession());
    await transport.start();
    const server = transport.getServer();
    expect(server).toBeDefined();
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
