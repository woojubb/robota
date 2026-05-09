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
    it('calls clearInterval when close() is invoked', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const httpServer = createServer();
      wsServer = new PlaygroundWebSocketServer(httpServer);

      wsServer.close();
      wsServer = null; // already closed, skip afterEach cleanup

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
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
          resolve();
        });

        ws.on('error', reject);

        // Fallback timeout
        setTimeout(() => resolve(), 2000);
      });

      // Server should have sent an error message
      const parsed = messages.map(
        (m) => JSON.parse(m) as { data?: { success?: boolean; error?: string } },
      );
      const errorMsg = parsed.find((m) => m.data?.success === false || m.data?.error);
      expect(errorMsg).toBeDefined();

      // Cleanup http server
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });
  });
});
