/**
 * Pure WebSocket server for agent session streaming.
 * No HTTP / static file serving — a separate HTTP server handles that.
 */

import { createServer, type Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createWsHandler } from '@robota-sdk/agent-transport-ws';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';
import type { TServerMessage } from '@robota-sdk/agent-transport-ws';

export interface IWsServerHandle {
  port: number;
  stop: () => Promise<void>;
}

const MAX_PORT_RETRIES = 20;

function tryBindWs(session: InteractiveSession, port: number): Promise<IWsServerHandle> {
  return new Promise((resolve, reject) => {
    // Minimal HTTP server — only exists so WebSocketServer can attach.
    // Non-upgrade requests return 400.
    const httpServer: Server = createServer((_, res) => {
      res.writeHead(400).end('WebSocket endpoint');
    });

    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      httpServer.close();
      reject(err);
    });

    httpServer.listen(port, '127.0.0.1', () => {
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

        // Send full history on connect so client can restore prior context
        const messages = session.getMessages();
        send({ type: 'messages', messages });
      });

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

export function startWsServer(session: InteractiveSession, port: number): Promise<IWsServerHandle> {
  const attempt = (p: number, left: number): Promise<IWsServerHandle> =>
    tryBindWs(session, p).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && left > 0) return attempt(p + 1, left - 1);
      throw err;
    });
  return attempt(port, MAX_PORT_RETRIES);
}
