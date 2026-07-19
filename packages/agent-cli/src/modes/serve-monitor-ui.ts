/**
 * GUI-007 — serve the CLI's built-in web monitor SPA (`packages/agent-cli-web`, copied to this package's
 * `dist/web`) over a localhost-only HTTP server, injecting the live `ws-url` into `index.html`. This is the
 * CLI OWNING and SERVING its own monitor (a localhost-origin surface) — the secure replacement for a deployed
 * page reaching into `localhost`. Kept SEPARATE from the WS transport (a neutral library must not serve a UI).
 *
 * SEC-001 hook: the injected `ws-url` is where the auth token rides (`?token=…`) once SEC-001 lands — the
 * server-injected URL is the token-delivery channel for this co-located browser client.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MONITOR_HOST = '127.0.0.1';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** A running monitor-UI HTTP server: its localhost URL + a graceful close. */
export interface IMonitorUiServer {
  url: string;
  close: () => Promise<void>;
}

/**
 * Resolve the built web-monitor asset root (`dist/web`, copied from `agent-cli-web` by `copy-web-assets`).
 * From the compiled module at `dist/node/…`, the assets sit at `dist/web`. Returns null if not present (a
 * dev tree without a CLI build) — the caller then skips serving the UI without failing the WS host.
 */
export function resolveWebRoot(): string | null {
  const candidate = fileURLToPath(new URL('../web', import.meta.url));
  return existsSync(join(candidate, 'index.html')) ? candidate : null;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Whether the request `Host` header is a loopback name (port stripped) — closes DNS-rebinding. A missing
 * `Host` is rejected (a well-formed HTTP/1.1 client always sends one). */
function isLoopbackHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : host.slice(0, host.lastIndexOf(':') === -1 ? host.length : host.lastIndexOf(':'));
  return LOOPBACK_HOSTS.has(name);
}

/** Inject `<meta name="ws-url" content="…">` into the served index.html so the SPA reaches the live WS. */
function injectWsUrl(html: string, wsUrl: string): string {
  const meta = `<meta name="ws-url" content="${wsUrl}" />`;
  return html.includes('</head>')
    ? html.replace('</head>', `    ${meta}\n  </head>`)
    : `${meta}\n${html}`;
}

/**
 * Start a localhost-only static server for the monitor SPA at `webRoot`, injecting `wsUrl` into index.html.
 * Binds an OS-assigned port on 127.0.0.1 only. Path-traversal is rejected (a served path must stay under root).
 */
export async function startMonitorUiServer(
  webRoot: string,
  wsUrl: string,
): Promise<IMonitorUiServer> {
  const server = createServer((req, res) => {
    // Defense-in-depth (SEC-001): reject a non-loopback Host so a DNS-rebinding page cannot read the
    // token-carrying index.html from this server, mirroring the WS transport's upgrade check.
    if (!isLoopbackHostHeader(req.headers.host)) {
      res.writeHead(403).end('Forbidden host');
      return;
    }
    // A malformed percent-encoding (e.g. `GET /%`) must NOT crash the serve host via an uncaught URIError —
    // SEC-001 treats localhost as hostile, so a co-resident process must not DoS the running agent.
    let rawPath: string;
    try {
      rawPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    const relPath = rawPath === '/' ? '/index.html' : rawPath;
    const filePath = normalize(join(webRoot, relPath));
    // Traversal guard: the resolved path must stay within webRoot.
    if (filePath !== webRoot && !filePath.startsWith(webRoot + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!existsSync(filePath)) {
      res.writeHead(404).end('Not found');
      return;
    }
    const isIndex = filePath.endsWith(`${sep}index.html`);
    const contentType = MIME[extname(filePath)] ?? 'application/octet-stream';
    if (isIndex) {
      const html = injectWsUrl(readFileSync(filePath, 'utf8'), wsUrl);
      res.writeHead(200, { 'content-type': contentType });
      res.end(html);
      return;
    }
    res.writeHead(200, { 'content-type': contentType });
    res.end(readFileSync(filePath));
  });

  await new Promise<void>((resolve) => server.listen(0, MONITOR_HOST, () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  const url = `http://${MONITOR_HOST}:${port}`;
  return {
    url,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Best-effort open of `url` in the default browser (macOS `open`, Windows `start`, else `xdg-open`). */
export function openInBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(cmd, [url], {
      stdio: 'ignore',
      detached: true,
      shell: process.platform === 'win32',
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // allow-fallback: opening the browser is a convenience — a failure must not crash the serve host.
  }
}
