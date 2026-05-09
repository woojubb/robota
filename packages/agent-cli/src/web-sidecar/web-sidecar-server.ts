/**
 * Web sidecar server — exposes a running InteractiveSession over WebSocket.
 *
 * Each connected browser client receives all session events in real-time
 * via the agent-transport-ws protocol. Phase 2: clients can also submit
 * prompts back to the session.
 */

import { createServer, type Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createWsHandler } from '@robota-sdk/agent-transport-ws';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';
import type { TServerMessage } from '@robota-sdk/agent-transport-ws';

export interface IWebSidecarServer {
  port: number;
  stop: () => Promise<void>;
}

export function startWebSidecarServer(
  session: InteractiveSession,
  port: number,
): Promise<IWebSidecarServer> {
  return new Promise((resolve, reject) => {
    const httpServer: Server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Robota web monitor sidecar');
    });

    const wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws: WebSocket) => {
      const send = (message: TServerMessage): void => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
      };

      const { onMessage, cleanup } = createWsHandler({ session, send });

      ws.on('message', (data) => onMessage(String(data)));
      ws.on('close', cleanup);
      ws.on('error', cleanup);

      // Send full history immediately on connect so client can restore prior context
      const messages = session.getMessages();
      send({ type: 'messages', messages });
    });

    httpServer.on('error', reject);

    httpServer.listen(port, '127.0.0.1', () => {
      resolve({
        port,
        stop: () =>
          new Promise<void>((res) => {
            wss.close(() => {
              httpServer.close(() => res());
            });
          }),
      });
    });
  });
}
