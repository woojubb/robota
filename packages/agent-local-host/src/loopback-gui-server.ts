/**
 * A loopback-only server for a product's built web GUI, admitted by a one-time access code.
 *
 * The GUI's index carries what the page needs to reach its runtime (such as the WebSocket URL with
 * its credential), so it is the one thing a co-resident program must not read. The index is served
 * only after a person types the access code the product printed: the code is exchanged once for an
 * HttpOnly, SameSite=Strict cookie scoped to an unpredictable path, and only that path serves the
 * index. A request whose Host is not a loopback name is refused, closing DNS rebinding, and every
 * served path is resolved once into a descriptor inside the web root. Localhost is treated as
 * hostile throughout: no request may crash the process that serves it.
 *
 * Any product composition root that serves its GUI on this machine uses this one server, so the
 * login gate has one implementation.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, sep } from 'node:path';

import { isPathInside } from '@robota-sdk/agent-core/node';

const LOOPBACK = '127.0.0.1';

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

/** Text of the access-code page. */
export interface ILoopbackGuiLabels {
  readonly title: string;
  readonly prompt: string;
  readonly submit: string;
}

const DEFAULT_LABELS: ILoopbackGuiLabels = {
  title: 'Monitor access',
  prompt: 'Access code from your terminal',
  submit: 'Open monitor',
};

export interface ILoopbackGuiServerOptions {
  /** The built GUI; its `index.html` is served only after the access code. */
  readonly webRoot: string;
  /** Markup placed before `</head>` of the index, such as the runtime's `<meta name="ws-url">`. */
  readonly headHtml: string;
  readonly labels?: Partial<ILoopbackGuiLabels>;
}

/** A running GUI server: its loopback URL, the code a person types, and a close that ends open connections. */
export interface ILoopbackGuiServer {
  readonly url: string;
  readonly accessCode: string;
  close: () => Promise<void>;
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function injectHead(html: string, headHtml: string): string {
  // A replacer function keeps `$&` and friends in the markup literal.
  return html.includes('</head>') ? html.replace('</head>', () => `    ${headHtml}\n  </head>`) : `${headHtml}\n${html}`;
}

/**
 * Start the server on an OS-assigned loopback port.
 */
export async function startLoopbackGuiServer(options: ILoopbackGuiServerOptions): Promise<ILoopbackGuiServer> {
  const { webRoot, headHtml } = options;
  const labels = { ...DEFAULT_LABELS, ...options.labels };
  // Canonicalized once: webRoot is a fixed build output for the life of the server, and every
  // request's containment decision is made against this resolved form.
  const webRootReal = realpathSync(webRoot);
  const accessCode = randomBytes(32).toString('base64url');
  const sessionCookie = randomBytes(32).toString('base64url');
  const sessionPath = `/${randomBytes(24).toString('base64url')}/`;

  const server = createServer((req, res) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    // Defense-in-depth: reject a non-loopback Host so a DNS-rebinding page cannot read the
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
        `<!doctype html><title>${escapeHtml(labels.title)}</title><form method="post" action="/__monitor_login">` +
        `<label>${escapeHtml(labels.prompt)} <input name="code" type="password" required autocomplete="off"></label>` +
        `<button type="submit">${escapeHtml(labels.submit)}</button></form>`,
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
    // Localhost is treated as hostile, so a co-resident process must not DoS the running agent.
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
    // Structural containment: split the URL path into segments and admit only plain names.
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
    // exception that takes the whole serve host down. Localhost is treated as hostile, so a
    // co-resident process must not be able to DoS the running agent with `GET /assets`.
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
      body = isIndex ? injectHead(readFileSync(fd, 'utf8'), headHtml) : readFileSync(fd);
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
    server.listen(0, LOOPBACK, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  const url = `http://${LOOPBACK}:${port}`;
  return {
    url,
    accessCode,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
