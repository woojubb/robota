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

// Walk up from the current file to find the package root (dir containing package.json).
// Works in all execution contexts:
//   tsx dev:   src/web-sidecar/ → src/ → packages/agent-cli/
//   built:     dist/node/       → dist/ → packages/agent-cli/
//   installed: node_modules/@robota-sdk/agent-cli/dist/node/ → ...
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

function findPackageRoot(startDir: string): string {
  let dir = startDir;
  let parent = dirname(dir);
  while (parent !== dir) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = parent;
    parent = dirname(dir);
  }
  if (existsSync(join(dir, 'package.json'))) return dir;
  throw new Error('Cannot locate package root from ' + startDir);
}

const WEB_DIST = join(findPackageRoot(__dirname), 'dist', 'web');

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const urlPath = req.url ?? '/';
  const fsPath = join(WEB_DIST, urlPath === '/' ? 'index.html' : urlPath);
  const ext = extname(fsPath);

  if (existsSync(fsPath) && ext) {
    res.writeHead(HTTP_OK, { 'Content-Type': MIME[ext] ?? 'text/plain' });
    res.end(readFileSync(fsPath));
    return;
  }

  // SPA fallback — serve index.html for any unknown path
  const index = join(WEB_DIST, 'index.html');
  if (existsSync(index)) {
    res.writeHead(HTTP_OK, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(readFileSync(index));
    return;
  }

  res.writeHead(HTTP_NOT_FOUND, { 'Content-Type': 'text/plain' });
  res.end('Web UI not found. Rebuild: pnpm --filter @robota-sdk/agent-cli build');
}

const MAX_PORT_RETRIES = 20;

function attachWss(session: InteractiveSession, httpServer: Server): WebSocketServer {
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

  return wss;
}

function tryListen(session: InteractiveSession, port: number): Promise<IWebSidecarServer> {
  return new Promise((resolve, reject) => {
    const httpServer: Server = createServer(serveStatic);

    // Register error handler before listen so EADDRINUSE is caught here, not thrown globally.
    // WSS is created only after successful bind to avoid the ws library forwarding
    // httpServer 'error' events to an unhandled WSS 'error' emitter.
    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      httpServer.close();
      reject(err);
    });

    httpServer.listen(port, '127.0.0.1', () => {
      const wss = attachWss(session, httpServer);
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

export function startWebSidecarServer(
  session: InteractiveSession,
  port: number,
): Promise<IWebSidecarServer> {
  const attempt = (currentPort: number, triesLeft: number): Promise<IWebSidecarServer> =>
    tryListen(session, currentPort).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && triesLeft > 0) {
        return attempt(currentPort + 1, triesLeft - 1);
      }
      throw err;
    });

  return attempt(port, MAX_PORT_RETRIES);
}
