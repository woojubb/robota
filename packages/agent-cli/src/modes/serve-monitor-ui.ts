/**
 * GUI-007 — serve the GUI web app (`packages/agent-gui-web`, copied to this package's
 * `dist/web`) over a localhost-only HTTP server, injecting the live `ws-url` into `index.html`. This is the
 * CLI OWNING and SERVING its own GUI (a localhost-origin surface) — the secure replacement for a deployed
 * page reaching into `localhost`. Kept SEPARATE from the WS transport (a neutral library must not serve a UI).
 *
 * The WS URL contains the transport credential. The index is served only after the operator enters
 * the terminal access code, and the resulting browser session is scoped to an unpredictable path.
 */

import { publicProductConfig } from '@robota-sdk/product-config';
import type { ICliRuntimeContext } from '../product/runtime-context.js';

import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isPathInside } from '@robota-sdk/agent-core/node';

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
  accessCode: string;
  close: () => Promise<void>;
}

/**
 * #3289 §3: what `--serve --open` prints once the page is up. "The product", not "web monitor" — the
 * person opening it is looking at their own running session, not a separate observability tool.
 */
export function servedAtMessage(url: string, runtime: ICliRuntimeContext): string {
  return `${runtime.config.identity.displayName} is open at ${url}\n`;
}

/**
 * Resolve the built web-monitor asset root (`dist/web`, assembled from a pinned web-producer generation).
 * From the compiled module at `dist/node/…`, the assets sit at `dist/web`. Returns null if not present (a
 * dev tree without a CLI build) — the caller then skips serving the UI without failing the WS host.
 */
export function resolveWebRoot(): string | null {
  const candidate = fileURLToPath(new URL('../web', import.meta.url));
  return existsSync(join(candidate, 'index.html')) ? candidate : null;
}

/** A separate product serves only assets explicitly packaged by its own entry. */
export function resolveProductWebRoot(runtime: ICliRuntimeContext): string | null {
  return runtime.artifact === undefined ? resolveWebRoot() : (runtime.artifact.webRoot ?? null);
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
function injectWsUrl(html: string, wsUrl: string, runtime: ICliRuntimeContext): string {
  const config = JSON.stringify(publicProductConfig(runtime.config)).replaceAll('<', '\\u003c');
  const meta = `<meta name="ws-url" content="${wsUrl}" /><script id="product-config" type="application/json">${config}</script>`;
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
  runtime: ICliRuntimeContext,
): Promise<IMonitorUiServer> {
  // Canonicalized once: webRoot is a fixed build output for the life of the server, and every
  // request's containment decision is made against this resolved form.
  const webRootReal = realpathSync(webRoot);
  const accessCode = randomBytes(32).toString('base64url');
  const sessionCookie = randomBytes(32).toString('base64url');
  const sessionPath = `/${randomBytes(24).toString('base64url')}/`;

  const server = createServer((req, res) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    // Defense-in-depth (SEC-001): reject a non-loopback Host so a DNS-rebinding page cannot read the
    // token-carrying index.html from this server, mirroring the WS transport's upgrade check.
    if (!isLoopbackHostHeader(req.headers.host)) {
      res.writeHead(403).end('Forbidden host');
      return;
    }
    if (req.method === 'POST' && req.url === '/__monitor_login') {
      let body = '';
      const deadline = setTimeout(() => req.destroy(), 10_000);
      deadline.unref();
      req.once('close', () => clearTimeout(deadline));
      req.setEncoding('utf8');
      req.setTimeout(10_000, () => req.destroy());
      req.on('error', () => {});
      req.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > 1024) req.destroy();
      });
      req.on('end', () => {
        const supplied = new URLSearchParams(body).get('code') ?? '';
        const expected = Buffer.from(accessCode);
        const actual = Buffer.from(supplied);
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
          res.writeHead(403).end('Invalid access code');
          return;
        }
        res.writeHead(303, {
          Location: sessionPath,
          'Set-Cookie': `robota_monitor=${sessionCookie}; HttpOnly; SameSite=Strict; Path=${sessionPath}`,
        }).end();
      });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end('Method not allowed');
      return;
    }
    if (req.url === '/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        'x-frame-options': 'DENY',
      }).end(
        '<!doctype html><title>Monitor access</title><form method="post" action="/__monitor_login">' +
        '<label>Access code from your terminal <input name="code" type="password" required autocomplete="off"></label>' +
        '<button type="submit">Open monitor</button></form>',
      );
      return;
    }
    const requestPath = (req.url ?? '/').split('?')[0];
    const isSession = requestPath.startsWith(sessionPath);
    if (isSession) {
      const cookies = (req.headers.cookie ?? '').split(';').map((cookie) => cookie.trim());
      const sessionCookies = cookies.filter((cookie) => cookie.startsWith('robota_monitor='));
      const supplied = Buffer.from(sessionCookies[0]?.slice('robota_monitor='.length) ?? '');
      const expected = Buffer.from(sessionCookie);
      if (sessionCookies.length !== 1 || supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
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
    const relPath = isSession
      ? rawPath === sessionPath ? '/index.html' : `/${rawPath.slice(sessionPath.length)}`
      : rawPath;
    // Structural containment (SEC-006): split the URL path into segments and admit only plain names.
    // A request cannot escape `webRoot` because it is never given a component that traverses — `..`,
    // `.` and embedded separators are rejected outright rather than normalized away afterwards.
    // This replaces a normalize-then-compare-prefix guard which was correct but only ACCIDENTALLY so:
    // it depended on `normalize` collapsing every traversal form before the comparison, which is
    // exactly the kind of reasoning that breaks the next time the path handling is touched.
    const segments = relPath.split('/').filter((segment) => segment.length > 0);
    const isPlainSegment = (segment: string): boolean =>
      segment !== '.' && segment !== '..' && !segment.includes(sep) && !segment.includes('\\');
    if (segments.length === 0 || !segments.every(isPlainSegment)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const lexicalPath = join(webRootReal, ...segments);
    // Segment validation alone is NOT containment: `escape` is a perfectly plain segment, and if it
    // is a symlink pointing outside webRoot then `join` stays inside lexically while the open follows
    // the link straight out. Only canonicalization sees through that, so containment is decided on
    // the realpath — the same defect, and the same fix, as the agent-tools file-tool path guard.
    let filePath: string;
    try {
      filePath = realpathSync(lexicalPath);
    } catch {
      // allow-fallback: an unresolvable path is simply not a servable asset.
      res.writeHead(404).end('Not found');
      return;
    }
    if (!isPathInside(webRootReal, filePath)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    // Only a regular FILE may be served. `existsSync` is also true for a directory, and
    // `readFileSync(<dir>)` throws EISDIR synchronously inside this request callback — an uncaught
    // exception that takes the whole serve host down. SEC-001 treats localhost as hostile, so a
    // co-resident process must not be able to DoS the running agent with `GET /assets` (SEC-006).
    //
    // The path is resolved EXACTLY ONCE, into a file descriptor, and the kind-check and the read both
    // operate on that descriptor. A path-based `stat` followed by a path-based `read` would be two
    // independent lookups that can disagree; with an fd there is nothing left to swap between them.
    const isIndex = filePath.endsWith(`${sep}index.html`);
    if (isIndex && !isSession) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const contentType = MIME[extname(filePath)] ?? 'application/octet-stream';
    let body: string | Buffer;
    let fd: number;
    try {
      fd = openSync(filePath, 'r');
    } catch {
      // allow-fallback: a missing or unreadable asset is a 404 for this static host — the only
      // alternative is crashing the agent the monitor is attached to.
      res.writeHead(404).end('Not found');
      return;
    }
    try {
      if (!fstatSync(fd).isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      body = isIndex ? injectWsUrl(readFileSync(fd, 'utf8'), wsUrl, runtime) : readFileSync(fd);
    } catch {
      // allow-fallback: an unreadable asset is a 404, for the same reason as above.
      res.writeHead(404).end('Not found');
      return;
    } finally {
      closeSync(fd);
    }
    res.writeHead(200, {
      'content-type': contentType,
      ...(filePath === join(webRootReal, 'app-sandbox.html')
        ? { 'Connection-Allowlist': '()' }
        : {}),
    });
    res.end(body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, MONITOR_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  const url = `http://${MONITOR_HOST}:${port}`;
  return {
    url,
    accessCode,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
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
