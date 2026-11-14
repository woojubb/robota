/**
 * Serve the Robota web GUI on loopback for the personal agent.
 *
 * Serving a UI is the composition root's job, not a library's, so this root owns its GUI server. The
 * page it serves carries the WebSocket credential, so it is handed out only after the person types
 * the access code printed at start: the code is exchanged once for an HttpOnly cookie scoped to an
 * unpredictable path, and every asset is served only under that path with that cookie. A request
 * whose Host is not loopback is refused, so a page served from another origin through DNS rebinding
 * cannot read the token-bearing index.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, sep } from 'node:path';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

const LOOPBACK = '127.0.0.1';
const COOKIE = 'personal_agent_session';
const MAX_LOGIN_BODY = 1024;

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export interface IGuiServer {
  readonly url: string;
  readonly accessCode: string;
  close(): Promise<void>;
}

/** The built GUI shipped by `@robota-sdk/agent-gui-web`, or `undefined` when it has not been built. */
export function resolveGuiRoot(): string | undefined {
  const require = createRequire(import.meta.url);
  try {
    const root = join(dirname(require.resolve('@robota-sdk/agent-gui-web/package.json')), 'dist');
    readFileSync(join(root, 'index.html'));
    return root;
  } catch {
    return undefined;
  }
}

function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined) return false;
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]';
}

function equalSecret(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function injectWsUrl(html: string, wsUrl: string): string {
  const meta = `<meta name="ws-url" content="${wsUrl.replaceAll('"', '&quot;')}" />`;
  return html.replace('</head>', `    ${meta}\n  </head>`);
}

function readLoginCode(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve) => {
    let body = '';
    req.setEncoding('utf8');
    req.setTimeout(10_000, () => req.destroy());
    req.on('error', () => resolve(undefined));
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_LOGIN_BODY) req.destroy();
    });
    req.on('end', () => resolve(new URLSearchParams(body).get('code') ?? undefined));
    req.on('close', () => resolve(undefined));
  });
}

/** Read a file under `root` through one descriptor, refusing anything that escapes it or is not a file. */
function readContained(root: string, relative: readonly string[]): Buffer | undefined {
  if (relative.some((segment) => segment === '' || segment === '.' || segment === '..' || segment.includes('\\'))) {
    return undefined;
  }
  let real: string;
  try {
    real = realpathSync(join(root, ...relative));
  } catch {
    return undefined;
  }
  if (!real.startsWith(root + sep)) return undefined;
  const fd = openSync(real, 'r');
  try {
    if (!fstatSync(fd).isFile()) return undefined;
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

export async function startGuiServer(options: { readonly webRoot: string; readonly wsUrl: string }): Promise<IGuiServer> {
  const root = realpathSync(options.webRoot);
  const accessCode = randomBytes(24).toString('base64url');
  const sessionCookie = randomBytes(32).toString('base64url');
  const sessionPath = `/${randomBytes(18).toString('base64url')}/`;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (!isLoopbackHost(req.headers.host)) {
      res.writeHead(403).end('Forbidden host');
      return;
    }
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    if (req.method === 'POST' && path === '/login') {
      const code = await readLoginCode(req);
      if (code === undefined || !equalSecret(code, accessCode)) {
        res.writeHead(403).end('Invalid access code');
        return;
      }
      res
        .writeHead(303, {
          Location: sessionPath,
          'Set-Cookie': `${COOKIE}=${sessionCookie}; HttpOnly; SameSite=Strict; Path=${sessionPath}`,
        })
        .end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end('Method not allowed');
      return;
    }
    if (path === '/') {
      res
        .writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
          'x-frame-options': 'DENY',
        })
        .end(
          '<!doctype html><title>Personal agent</title><form method="post" action="/login">' +
            '<label>Access code <input name="code" type="password" required autocomplete="off"></label>' +
            '<button type="submit">Open</button></form>',
        );
      return;
    }
    if (!path.startsWith(sessionPath)) {
      res.writeHead(404).end('Not found');
      return;
    }
    const cookies = (req.headers.cookie ?? '').split(';').map((cookie) => cookie.trim());
    const ours = cookies.filter((cookie) => cookie.startsWith(`${COOKIE}=`));
    if (ours.length !== 1 || !equalSecret(ours[0]!.slice(COOKIE.length + 1), sessionCookie)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let segments: string[];
    try {
      segments = path.slice(sessionPath.length).split('/').map((segment) => decodeURIComponent(segment));
    } catch {
      res.writeHead(400).end('Bad path');
      return;
    }
    if (segments.length === 1 && segments[0] === '') segments = ['index.html'];
    const body = readContained(root, segments);
    if (body === undefined) {
      res.writeHead(404).end('Not found');
      return;
    }
    const type = MIME[extname(segments[segments.length - 1]!)] ?? 'application/octet-stream';
    const content = type.startsWith('text/html') ? Buffer.from(injectWsUrl(body.toString('utf8'), options.wsUrl)) : body;
    res.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : content);
  };

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, LOOPBACK, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://${LOOPBACK}:${port}/`,
    accessCode,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
