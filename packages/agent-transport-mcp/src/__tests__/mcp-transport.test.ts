import { runTransportLifecycleConformance } from '@robota-sdk/agent-interface-transport/testing';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { createMcpTransport } from '../mcp-transport.js';
import type { IMcpTransportSession } from '../mcp-session.js';
import type { ITransportAdapter } from '@robota-sdk/agent-interface-transport';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

function createMockSession(): IInteractiveSession {
  return Object.assign(createTestInteractiveSession(), {
    submit: vi.fn(),
    abort: vi.fn(),
    cancelQueue: vi.fn(),
    getMessages: vi.fn().mockReturnValue([]),
    getContextState: vi
      .fn()
      .mockReturnValue({ usedPercentage: 0, usedTokens: 0, maxTokens: 200000 }),
    isExecuting: vi.fn().mockReturnValue(false),
    getPendingPrompt: vi.fn().mockReturnValue(null),
    executeCommand: vi.fn().mockResolvedValue({ message: 'ok', success: true }),
    listCommands: vi.fn().mockReturnValue([]),
    on: vi.fn(),
    off: vi.fn(),
  });
}

describe('createMcpTransport', () => {
  it('preserves the legacy adapter declaration and accepts the named subset', () => {
    const transport = createMcpTransport({ name: 'test', version: '1.0.0' });
    expectTypeOf(transport).toMatchTypeOf<ITransportAdapter<IInteractiveSession>>();
    expectTypeOf(transport.attach).parameter(0).toMatchTypeOf<IMcpTransportSession>();
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
    transport.attach(createMockSession() as never);
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
