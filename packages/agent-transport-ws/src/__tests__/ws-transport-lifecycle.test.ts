import { createServer } from 'node:net';

import { runTransportLifecycleConformance } from '@robota-sdk/agent-interface-transport/testing';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import { WebSocket } from 'ws';
import { describe, it, expect, expectTypeOf, vi, afterEach } from 'vitest';

import { WsTransport } from '../ws-transport-configurable.js';

import type { IConfigurableTransport } from '@robota-sdk/agent-interface-transport';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type { IProtocolSession } from '@robota-sdk/agent-transport-protocol';

/**
 * ARCH-004 RUNTIME-13 — `stop()` must resolve even with a client still connected.
 *
 * Before the fix, `stop()` did `wss.close(cb)`, whose callback fires only after every client socket is gone,
 * so a live client made `stop()` hang forever. The fix sends a close frame to each client and terminates any
 * survivor at a 5s deadline, so the server-close callback always resolves.
 */

function mockSession(): IInteractiveSession {
  return Object.assign(createTestInteractiveSession(), {
    getMessages: vi.fn().mockReturnValue([]),
    getExecutionWorkspaceSnapshot: vi.fn().mockReturnValue({ entries: [] }),
    on: vi.fn(),
    off: vi.fn(),
    submit: vi.fn(),
    abort: vi.fn(),
    cancelQueue: vi.fn(),
  });
}

const started: WsTransport[] = [];
afterEach(async () => {
  while (started.length) await started.pop()!.stop();
});

describe('WsTransport lifecycle (ARCH-004 RUNTIME-13)', () => {
  it('preserves the legacy adapter declaration and accepts the named subset', () => {
    const transport = new WsTransport({
      open: true,
      openReason: 'type compatibility test',
    });
    expectTypeOf(transport).toMatchTypeOf<IConfigurableTransport<IInteractiveSession>>();
    expectTypeOf(transport.attach).parameter(0).toMatchTypeOf<IProtocolSession>();
  });

  it('stop() resolves promptly with a client still connected (previously hung forever)', async () => {
    const t = new WsTransport({
      port: 17800,
      maxRetries: 40,
      open: true,
      openReason: 'SEC-008: this case is about the stop() lifecycle, not admission',
    });
    t.attach(mockSession());
    await t.start();
    started.push(t);
    const port = t.boundPort;

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    const startedAt = Date.now();
    await t.stop(); // must not hang — the whole test would time out if it did
    const elapsed = Date.now() - startedAt;

    // A well-behaved client closes on the 1001 frame, so stop() resolves well under the 5s terminate deadline.
    expect(elapsed).toBeLessThan(4500);
    started.pop(); // already stopped
    try {
      ws.terminate();
    } catch {
      /* already closed */
    }
  });

  it('can retry start after a bind failure without an intervening stop', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(0, '127.0.0.1', resolve);
    });
    const address = blocker.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address.');

    const transport = new WsTransport({
      port: address.port,
      maxRetries: 0,
      open: true,
      openReason: 'bind failure lifecycle regression',
    });
    transport.attach(mockSession());
    let blockerOpen = true;
    try {
      await expect(transport.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
      await new Promise<void>((resolve, reject) =>
        blocker.close((error) => (error ? reject(error) : resolve())),
      );
      blockerOpen = false;

      await expect(transport.start()).resolves.toBeUndefined();
      started.push(transport);
      expect(transport.boundPort).toBe(address.port);
    } finally {
      if (blockerOpen) {
        await new Promise<void>((resolve) => blocker.close(() => resolve()));
      }
    }
  });

  it('invokes the shared lifecycle conformance suite', async () => {
    await runTransportLifecycleConformance({
      subjectId: '@robota-sdk/agent-transport-ws#WsTransport',
      kind: 'service',
      createAdapter: () =>
        new WsTransport({
          port: 0,
          open: true,
          openReason: 'ARCH-011 lifecycle conformance',
        }),
      createSession: mockSession,
      assertReady: (transport) => {
        if (transport.boundPort === undefined) throw new Error('WS endpoint not bound');
      },
      assertStopped: (transport) => {
        if (transport.boundPort !== undefined) throw new Error('WS endpoint still bound');
      },
    });
  });
});
