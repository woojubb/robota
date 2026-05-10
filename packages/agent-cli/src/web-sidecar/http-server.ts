/**
 * Static-file HTTP server for the bundled React SPA.
 * Injects the WebSocket server URL via <meta name="ws-url"> so the SPA
 * knows exactly which port to connect to without runtime guessing.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface IHttpServerHandle {
  port: number;
  stop: () => Promise<void>;
}

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

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

export const WEB_DIST = join(findPackageRoot(__dirname), 'dist', 'web');

const LOADING_PLACEHOLDER =
  `<div style="min-height:100vh;background:#1e1e2e;display:flex;align-items:center;` +
  `justify-content:center;color:#8b8ba3;font-family:monospace;font-size:12px;` +
  `letter-spacing:0.1em;text-transform:uppercase">Initializing…</div>`;

function injectWsUrl(html: string, wsUrl: string): string {
  return html
    .replace('<head>', `<head>\n    <meta name="ws-url" content="${wsUrl}" />`)
    .replace('<div id="root"></div>', `<div id="root">${LOADING_PLACEHOLDER}</div>`);
}

function serveHtml(res: ServerResponse, filePath: string, wsUrl: string): void {
  const raw = readFileSync(filePath, 'utf-8');
  const html = injectWsUrl(raw, wsUrl);
  res.writeHead(HTTP_OK, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

const MAX_PORT_RETRIES = 20;

export function startHttpServer(options: {
  wsUrl: string;
  port: number;
  webDistPath?: string;
}): Promise<IHttpServerHandle> {
  const { wsUrl, webDistPath = WEB_DIST } = options;

  function handler(req: IncomingMessage, res: ServerResponse): void {
    const urlPath = req.url?.split('?')[0] ?? '/';
    const fsPath = join(webDistPath, urlPath === '/' ? 'index.html' : urlPath);
    const ext = extname(fsPath);

    if (existsSync(fsPath) && ext) {
      if (ext === '.html') {
        serveHtml(res, fsPath, wsUrl);
      } else {
        res.writeHead(HTTP_OK, { 'Content-Type': MIME[ext] ?? 'text/plain' });
        res.end(readFileSync(fsPath));
      }
      return;
    }

    // SPA fallback — any unknown path serves index.html
    const index = join(webDistPath, 'index.html');
    if (existsSync(index)) {
      serveHtml(res, index, wsUrl);
      return;
    }

    res.writeHead(HTTP_NOT_FOUND, { 'Content-Type': 'text/plain' });
    res.end('Web UI not found. Rebuild: pnpm --filter @robota-sdk/agent-cli build');
  }

  const attempt = (p: number, left: number): Promise<IHttpServerHandle> =>
    new Promise<IHttpServerHandle>((resolve, reject) => {
      const httpServer = createServer(handler);
      httpServer.on('error', (err: NodeJS.ErrnoException) => {
        httpServer.close();
        reject(err);
      });
      httpServer.listen(p, '127.0.0.1', () => {
        resolve({
          port: p,
          stop: () => new Promise<void>((res) => httpServer.close(() => res())),
        });
      });
    }).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && left > 0) return attempt(p + 1, left - 1);
      throw err;
    });

  return attempt(options.port, MAX_PORT_RETRIES);
}
