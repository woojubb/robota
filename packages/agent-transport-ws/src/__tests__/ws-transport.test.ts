import { runTransportLifecycleConformance } from '@robota-sdk/agent-interface-transport/testing';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { createWsTransport } from '../ws-transport.js';
import type { ITransportAdapter } from '@robota-sdk/agent-interface-transport';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type { IProtocolSession } from '@robota-sdk/agent-transport-protocol';

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

describe('createWsTransport', () => {
  it('preserves the legacy adapter declaration and accepts the named subset', () => {
    const transport = createWsTransport({ send: vi.fn() });
    expectTypeOf(transport).toMatchTypeOf<ITransportAdapter<IInteractiveSession>>();
    expectTypeOf(transport.attach).parameter(0).toMatchTypeOf<IProtocolSession>();
  });

  it('returns an adapter with name "ws"', () => {
    const transport = createWsTransport({ send: vi.fn() });
    expect(transport.name).toBe('ws');
  });

  it('throws if start() is called without attach()', async () => {
    const transport = createWsTransport({ send: vi.fn() });
    await expect(transport.start()).rejects.toMatchObject({
      name: 'TransportLifecycleError',
      code: 'not-attached',
    });
  });

  it('onMessage is null before start()', () => {
    const transport = createWsTransport({ send: vi.fn() });
    expect(transport.onMessage).toBeNull();
  });

  it('provides onMessage after attach + start', async () => {
    const transport = createWsTransport({ send: vi.fn() });
    transport.attach(createMockSession() as never);
    await transport.start();
    expect(typeof transport.onMessage).toBe('function');
  });

  it('clears onMessage after stop()', async () => {
    const transport = createWsTransport({ send: vi.fn() });
    transport.attach(createMockSession() as never);
    await transport.start();
    await transport.stop();
    expect(transport.onMessage).toBeNull();
  });

  it('isolates an outbound failure, cleans subscriptions, and reports to the carrier owner', async () => {
    const handlers = new Map<string, (value: unknown) => void>();
    const session = createTestInteractiveSession({
      on: ((event: string, handler: (value: unknown) => void) => {
        handlers.set(event, handler);
      }) as IInteractiveSession['on'],
      off: ((event: string) => {
        handlers.delete(event);
      }) as IInteractiveSession['off'],
    });
    const onDeliveryError = vi.fn();
    const transport = createWsTransport({
      send: () => {
        throw new Error('functional adapter socket closed');
      },
      onDeliveryError,
    });
    transport.attach(session);
    await transport.start();

    expect(() =>
      handlers.get('branch_event')?.({
        kind: 'checkpoint_created',
        checkpointId: 'turn-0001',
        branchId: 'main',
      }),
    ).not.toThrow();
    expect(onDeliveryError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'functional adapter socket closed' }),
      'branch_event',
    );
    expect(handlers.size).toBe(0);
    expect(transport.onMessage).toBeNull();
  });

  it('invokes the shared lifecycle conformance suite', async () => {
    await runTransportLifecycleConformance({
      subjectId: '@robota-sdk/agent-transport-ws#createWsTransport',
      kind: 'service',
      createAdapter: () => createWsTransport({ send: vi.fn() }),
      createSession: createMockSession,
      assertReady: (transport) => {
        if (typeof transport.onMessage !== 'function') throw new Error('WS handler not ready');
      },
      assertStopped: (transport) => {
        if (transport.onMessage !== null) throw new Error('WS handler still ready');
      },
    });
  });
});
