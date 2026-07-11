import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { startSignalingServer, type ISignalingServerHandle } from '../server.js';

/**
 * REMOTE-011 E2 — transport-layer DoS bounds enforced in `server.ts`, exercised with REAL `ws` client
 * connections (these live ABOVE the fake-peer relay seam, so they need a real socket). Covers the total +
 * per-IP connection caps, the injected address-resolver seam, `maxPayload` (close 1009), and the
 * connection-counter memory bound.
 */

function connect(url: string, headers?: Record<string, string>): WebSocket {
  return new WebSocket(url, headers ? { headers } : undefined);
}

function onceOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
}

function onceClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.on('close', (code: number, reason: Buffer) => resolve({ code, reason: reason.toString() }));
  });
}

function onceMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.on('message', (data: Buffer) =>
      resolve(JSON.parse(data.toString()) as Record<string, unknown>),
    );
  });
}

async function poll(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('poll timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function withServer(
  options: Parameters<typeof startSignalingServer>[0],
  run: (server: ISignalingServerHandle, url: string) => Promise<void>,
): Promise<void> {
  const server = await startSignalingServer(options);
  try {
    await run(server, `ws://127.0.0.1:${server.port}`);
  } finally {
    await server.close();
  }
}

describe('signaling server transport caps (REMOTE-011 E2)', () => {
  it('TC-02: closes the (N+1)-th connection over the total cap; admits again after one closes', async () => {
    await withServer({ maxConnections: 2 }, async (server, url) => {
      const a = connect(url);
      const b = connect(url);
      await Promise.all([onceOpen(a), onceOpen(b)]);
      await poll(() => server.connectionCount === 2);

      const c = connect(url); // over the cap
      const closed = await onceClose(c);
      expect(closed.code).toBe(1013);
      expect(server.connectionCount).toBe(2);

      a.close();
      await poll(() => server.connectionCount === 1);
      const d = connect(url); // room again
      await onceOpen(d);
      await poll(() => server.connectionCount === 2);

      b.close();
      d.close();
    });
  }, 15000);

  it('TC-03: per-IP cap refuses a second connection sharing a source key, admits a different key', async () => {
    // Inject an address resolver keyed off a test header so distinct source keys are testable over loopback.
    await withServer(
      {
        maxConnectionsPerIp: 1,
        addressResolver: (req) => {
          const h = req.headers['x-test-ip'];
          return typeof h === 'string' ? h : undefined;
        },
      },
      async (server, url) => {
        const a1 = connect(url, { 'x-test-ip': 'A' });
        await onceOpen(a1);
        await poll(() => server.connectionCount === 1);

        const a2 = connect(url, { 'x-test-ip': 'A' }); // same source key → refused
        expect((await onceClose(a2)).code).toBe(1013);

        const b1 = connect(url, { 'x-test-ip': 'B' }); // different key → admitted
        await onceOpen(b1);
        await poll(() => server.connectionCount === 2);

        a1.close();
        b1.close();
      },
    );
  }, 15000);

  it('TC-03: maxConnectionsPerIp:0 disables the per-IP cap', async () => {
    await withServer(
      {
        maxConnectionsPerIp: 0,
        addressResolver: () => 'same', // everything collapses to one key
      },
      async (server, url) => {
        const a = connect(url, { 'x-test-ip': 'A' });
        const b = connect(url, { 'x-test-ip': 'A' });
        await Promise.all([onceOpen(a), onceOpen(b)]); // both admitted despite one key
        await poll(() => server.connectionCount === 2);
        a.close();
        b.close();
      },
    );
  }, 15000);

  it('TC-04: a frame over maxFrameBytes closes with 1009; a small frame still relays (joined)', async () => {
    await withServer({ maxFrameBytes: 1024 }, async (_server, url) => {
      // Small frame: a normal join succeeds.
      const ok = connect(url);
      await onceOpen(ok);
      const reply = onceMessage(ok);
      ok.send(JSON.stringify({ type: 'join', rendezvous: 'r' }));
      expect((await reply).type).toBe('joined');
      ok.close();

      // Oversized frame: ws closes the connection with 1009 before our handler sees it.
      const big = connect(url);
      await onceOpen(big);
      const closed = onceClose(big);
      big.send('x'.repeat(4096));
      expect((await closed).code).toBe(1009);
    });
  }, 15000);

  it('TC-06: the connection counter returns to 0 after all sockets disconnect (memory bound)', async () => {
    await withServer({}, async (server, url) => {
      const a = connect(url);
      const b = connect(url);
      await Promise.all([onceOpen(a), onceOpen(b)]);
      await poll(() => server.connectionCount === 2);
      a.close();
      b.close();
      await poll(() => server.connectionCount === 0);
      expect(server.connectionCount).toBe(0);
    });
  }, 15000);
});
