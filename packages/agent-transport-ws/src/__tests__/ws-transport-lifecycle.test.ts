import { WebSocket } from 'ws';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { WsTransport } from '../ws-transport-configurable.js';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';

/**
 * ARCH-004 RUNTIME-13 — `stop()` must resolve even with a client still connected.
 *
 * Before the fix, `stop()` did `wss.close(cb)`, whose callback fires only after every client socket is gone,
 * so a live client made `stop()` hang forever. The fix sends a close frame to each client and terminates any
 * survivor at a 5s deadline, so the server-close callback always resolves.
 */

function mockSession(): IInteractiveSession {
  return {
    getMessages: vi.fn().mockReturnValue([]),
    getExecutionWorkspaceSnapshot: vi.fn().mockReturnValue({ entries: [] }),
    on: vi.fn(),
    off: vi.fn(),
    submit: vi.fn(),
    abort: vi.fn(),
    cancelQueue: vi.fn(),
  } as unknown as IInteractiveSession;
}

const started: WsTransport[] = [];
afterEach(async () => {
  while (started.length) await started.pop()!.stop();
});

describe('WsTransport lifecycle (ARCH-004 RUNTIME-13)', () => {
  it('stop() resolves promptly with a client still connected (previously hung forever)', async () => {
    const t = new WsTransport({ port: 17800, maxRetries: 40, open: true });
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
});
