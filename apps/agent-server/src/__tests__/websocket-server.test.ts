import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer } from 'http';
import { PlaygroundWebSocketServer } from '../websocket-server.js';

describe('PlaygroundWebSocketServer', () => {
  let wsServer: PlaygroundWebSocketServer | null = null;

  afterEach(() => {
    if (wsServer) {
      wsServer.close();
      wsServer = null;
    }
  });

  describe('SRV-002 regression: close() clears the cleanup interval', () => {
    it('clears the interval it created, not merely some interval', () => {
      // HARNESS-052: this asserted only `toHaveBeenCalled()` on a spy over the GLOBAL
      // clearInterval, so any clearInterval anywhere during close() satisfied it — including the
      // `ws` library's own internals. Falsified: replacing `clearInterval(this.cleanupInterval)`
      // with `clearInterval(setInterval(() => {}, 1e9))` restores the SRV-002 timer leak in full
      // and the test still passed. Binding the assertion to the handle the constructor actually
      // created is what makes it a regression guard rather than a call counter.
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const httpServer = createServer();
      wsServer = new PlaygroundWebSocketServer(httpServer);

      // The cleanup timer the constructor registered.
      expect(setIntervalSpy).toHaveBeenCalled();
      const cleanupHandle = setIntervalSpy.mock.results.at(-1)?.value;
      expect(cleanupHandle).toBeDefined();

      wsServer.close();
      wsServer = null; // already closed, skip afterEach cleanup

      expect(clearIntervalSpy).toHaveBeenCalledWith(cleanupHandle);
      clearIntervalSpy.mockRestore();
      setIntervalSpy.mockRestore();
    });
  });

  describe('getStats()', () => {
    it('returns zero counts for a fresh server with no connections', () => {
      const httpServer = createServer();
      wsServer = new PlaygroundWebSocketServer(httpServer);

      const stats = wsServer.getStats();
      expect(stats.totalConnections).toBe(0);
      expect(stats.authenticatedConnections).toBe(0);
      expect(stats.uniqueUsers).toBe(0);
      expect(stats.uniqueSessions).toBe(0);
    });
  });

  describe('SEC-001 regression: empty token must be rejected', () => {
    it('rejects connection attempt with empty token (client.ws.close called)', async () => {
      const httpServer = createServer();
      wsServer = new PlaygroundWebSocketServer(httpServer);

      // Start listening so ws can connect
      await new Promise<void>((resolve) => httpServer.listen(0, resolve));
      const port = (httpServer.address() as { port: number }).port;

      const { WebSocket } = await import('ws');

      const messages: string[] = [];
      // HARNESS-052: the close is OBSERVED, not assumed. This test's title names `client.ws.close`
      // and its only assertion used to be `expect(errorMsg).toBeDefined()` — satisfied by any error
      // frame, including the unrelated "Invalid auth payload" branch, and saying nothing about
      // whether the socket was closed. Measured: reintroducing the SEC-001 hole (drop the
      // `client.ws.close()` and set `client.isAuthenticated = true`) did turn the suite red, but by
      // `httpServer.close()` hanging on the still-open socket until the 5s vitest timeout — an
      // accidental red whose message read "Test timed out in 5000ms". A raised testTimeout or a
      // forced teardown would have retired that signal without anyone noticing.
      let closed = false;
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/ws/playground`);

        ws.on('open', () => {
          // Send auth message with empty token
          ws.send(
            JSON.stringify({
              type: 'auth',
              timestamp: new Date().toISOString(),
              data: {
                userId: 'user-123',
                sessionId: 'session-456',
                token: '',
              },
            }),
          );
        });

        ws.on('message', (data: Buffer) => {
          messages.push(data.toString());
        });

        // Connection should be closed by the server after empty token
        ws.on('close', () => {
          closed = true;
          resolve();
        });

        ws.on('error', reject);

        // Fallback so a server that never closes fails on the ASSERTION below rather than on the
        // suite's timeout — the distinction between a named failure and an accidental one.
        setTimeout(() => {
          ws.terminate();
          resolve();
        }, 2000);
      });

      // The contract this test is named for: the server CLOSED the socket.
      expect(closed).toBe(true);

      // …and it said why, specifically. A bare "some error frame arrived" also accepts the
      // "Invalid auth payload" branch, which is a different rejection for a different reason.
      const parsed = messages.map(
        (m) => JSON.parse(m) as { data?: { success?: boolean; error?: string } },
      );
      const errorMsg = parsed.find((m) => m.data?.success === false || m.data?.error);
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.data?.error).toBe('Missing authentication token');

      // Cleanup http server
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });
  });
});
