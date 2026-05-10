/**
 * Web sidecar server — exposes a running InteractiveSession over WebSocket
 * and serves the bundled React SPA (dist/web/) as static files.
 *
 * Single port (default 7070) handles both:
 *   - HTTP GET /           → SPA index.html
 *   - HTTP GET /assets/*   → JS/CSS bundles
 *   - WS upgrade           → agent-transport-ws protocol
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createWsHandler } from '@robota-sdk/agent-transport-ws';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';
import type { TServerMessage } from '@robota-sdk/agent-transport-ws';

export interface IWebSidecarServer {
  port: number;
  stop: () => Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = join(__dirname, '..', 'web');

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const urlPath = req.url ?? '/';
  const fsPath = join(WEB_DIST, urlPath === '/' ? 'index.html' : urlPath);
  const ext = extname(fsPath);

  if (existsSync(fsPath) && ext) {
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'text/plain' });
    res.end(readFileSync(fsPath));
    return;
  }

  // SPA fallback — serve index.html for any unknown path
  const index = join(WEB_DIST, 'index.html');
  if (existsSync(index)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(readFileSync(index));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Web UI not found. Rebuild: pnpm --filter @robota-sdk/agent-cli build');
}

export function startWebSidecarServer(
  session: InteractiveSession,
  port: number,
): Promise<IWebSidecarServer> {
  return new Promise((resolve, reject) => {
    const httpServer: Server = createServer(serveStatic);
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
