import {
  cleanupTestProductRuntimes,
  createTestProductRuntime,
} from '../../__tests__/helpers/product-runtime.js';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  realpathSync,
  renameSync,
} from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Raw HTTP GET that sends `rawPath` verbatim (no client-side URL normalization) — to exercise the
 * traversal guard, since `fetch` collapses `../` before it reaches the server. */
function rawGet(
  url: string,
  rawPath: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname, port, path: rawPath, method: 'GET', ...(headers ? { headers } : {}) },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

import {
  resolveProductWebRoot,
  servedAtMessage,
  startMonitorUiServer,
  type IMonitorUiServer,
} from '../serve-monitor-ui.js';

afterAll(cleanupTestProductRuntimes);

it('requires separate-product assets rather than serving the installed CLI monitor', () => {
  const runtime = createTestProductRuntime('cedar');
  expect(resolveProductWebRoot({ ...runtime, artifact: { version: '1.2.3' } })).toBeNull();
  expect(
    resolveProductWebRoot({ ...runtime, artifact: { version: '1.2.3', webRoot: '/consumer/web' } }),
  ).toBe('/consumer/web');
});

/**
 * GUI-007 — the CLI-served web monitor static host. Verifies: index.html gets the live `ws-url` injected, a
 * static asset is served, a missing path is 404, and a path-traversal attempt is rejected (403).
 */
describe('startMonitorUiServer (GUI-007)', () => {
  let fixtureRoot: string;
  let webRoot: string;
  let server: IMonitorUiServer;
  const wsUrl = 'ws://127.0.0.1:7070?token=dummy-token';

  async function authenticate(): Promise<{ path: string; cookie: string }> {
    const response = await fetch(`${server.url}/__monitor_login`, {
      method: 'POST',
      body: new URLSearchParams({ code: server.accessCode }),
      redirect: 'manual',
    });
    expect(response.status).toBe(303);
    const path = response.headers.get('location');
    const cookie = response.headers.get('set-cookie');
    if (!path || !cookie) throw new Error('Monitor login did not return a session');
    return { path, cookie: cookie.split(';')[0]! };
  }

  beforeAll(async () => {
    fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'monitor-ui-')));
    webRoot = join(fixtureRoot, 'web');
    mkdirSync(join(webRoot, 'assets'), { recursive: true });
    writeFileSync(
      join(webRoot, 'index.html'),
      '<!DOCTYPE html><html><head><title>M</title></head><body><div id="root"></div></body></html>',
    );
    writeFileSync(join(webRoot, 'assets', 'app.js'), 'export const x = 1;');
    writeFileSync(join(webRoot, 'app-sandbox.html'), '<html>isolated app sandbox</html>');
    writeFileSync(
      join(webRoot, 'assets', 'app-sandbox.html'),
      '<html>ordinary nested asset</html>',
    );
    symlinkSync(join(webRoot, 'app-sandbox.html'), join(webRoot, 'sandbox-alias.html'));
    // a sensitive file OUTSIDE webRoot the traversal test tries to reach
    writeFileSync(join(webRoot, '..', 'secret.txt'), 'top-secret');
    // symlinks INSIDE webRoot that escape it — a lexical containment check cannot see through these
    symlinkSync(join(webRoot, '..'), join(webRoot, 'escape'));
    symlinkSync(join(webRoot, '..', 'secret.txt'), join(webRoot, 'secret-link.txt'));
    server = await startMonitorUiServer(webRoot, wsUrl, createTestProductRuntime());
  });
  afterAll(async () => {
    await server.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('injects the live ws-url meta into index.html', async () => {
    const { path, cookie } = await authenticate();
    const res = await fetch(`${server.url}${path}`, { headers: { cookie } });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(`<meta name="ws-url" content="${wsUrl}" />`);
  });

  it('does not expose the token before a valid local login', async () => {
    const landing = await fetch(`${server.url}/`);
    expect(landing.status).toBe(200);
    expect(await landing.text()).not.toContain('dummy-token');
    expect((await fetch(`${server.url}/index.html`)).status).toBe(403);
    const bad = await fetch(`${server.url}/__monitor_login`, {
      method: 'POST', body: new URLSearchParams({ code: 'wrong' }), redirect: 'manual',
    });
    expect(bad.status).toBe(403);
    const { path, cookie } = await authenticate();
    expect((await fetch(`${server.url}${path}`)).status).toBe(403);
    const allowed = await fetch(`${server.url}${path}`, { headers: { cookie } });
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toContain('dummy-token');
    expect(allowed.headers.get('referrer-policy')).toBe('no-referrer');
    expect((await fetch(`${server.url}${path}assets/app.js`)).status).toBe(403);
    const asset = await fetch(`${server.url}${path}assets/app.js`, { headers: { cookie } });
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain('export const x = 1;');
  });

  it('closes even when a login request has not finished sending its body', async () => {
    const temporary = await startMonitorUiServer(webRoot, wsUrl, createTestProductRuntime());
    const req = request(`${temporary.url}/__monitor_login`, {
      method: 'POST', headers: { 'content-length': '1000' },
    });
    req.on('error', () => {});
    req.write('code=partial');
    await new Promise<void>((resolve, reject) => {
      req.once('socket', (socket) => socket.once('connect', resolve));
      req.once('error', reject);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const closing = temporary.close();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        closing,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Monitor close was delayed')), 1500);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      req.destroy();
      await closing;
    }
  });

  it('bounds a login request even while the client keeps sending data', async () => {
    const temporary = await startMonitorUiServer(webRoot, wsUrl, createTestProductRuntime());
    const req = request(`${temporary.url}/__monitor_login`, {
      method: 'POST', headers: { 'content-length': '1000' },
    });
    req.on('error', () => {});
    req.write('code=partial');
    const drip = setInterval(() => req.write('x'), 500);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        new Promise<void>((resolve) => req.once('error', () => resolve())),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Login exceeded its deadline')), 12_000);
        }),
      ]);
    } finally {
      clearInterval(drip);
      if (timeout) clearTimeout(timeout);
      req.destroy();
      await temporary.close();
    }
  }, 15_000);

  it('serves a static asset with a JS content-type', async () => {
    const res = await fetch(`${server.url}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toContain('export const x = 1;');
  });

  it.each(['/app-sandbox.html', '/app-sandbox.html?view=counter', '/sandbox-alias.html'])(
    'restricts native connections for the canonical sandbox asset at %s',
    async (path) => {
      const response = await fetch(`${server.url}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('connection-allowlist')).toBe('()');
      expect(await response.text()).toBe('<html>isolated app sandbox</html>');
    },
  );

  it.each(['/', '/assets/app.js', '/assets/app-sandbox.html'])(
    'does not restrict the ordinary host asset at %s',
    async (path) => {
      const response = await fetch(`${server.url}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.has('connection-allowlist')).toBe(false);
    },
  );

  it('keeps serving the startup generation after its public pointer is replaced', async () => {
    const pointer = join(fixtureRoot, 'current');
    const nextPointer = join(fixtureRoot, 'next');
    const replacement = join(fixtureRoot, 'replacement');
    mkdirSync(replacement);
    writeFileSync(join(replacement, 'index.html'), '<html>replacement</html>');
    symlinkSync(webRoot, pointer, 'junction');
    const pinnedServer = await startMonitorUiServer(pointer, wsUrl, createTestProductRuntime());
    try {
      symlinkSync(replacement, nextPointer, 'junction');
      // Windows replacement is explicitly non-atomic; the server must still pin its generation.
      if (process.platform === 'win32') rmSync(pointer);
      renameSync(nextPointer, pointer);
      const response = await fetch(`${pinnedServer.url}/assets/app.js`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('export const x = 1;');
    } finally {
      await pinnedServer.close();
    }
  });

  it('returns 404 for a missing path', async () => {
    const res = await fetch(`${server.url}/does-not-exist.js`);
    expect(res.status).toBe(404);
  });

  it('rejects a path-traversal attempt (403), never leaking a file outside webRoot', async () => {
    // Raw path (no client normalization) so the server actually sees `../` — the guard must reject it.
    const res = await rawGet(server.url, '/../secret.txt');
    expect(res.status).toBe(403);
    expect(res.body).not.toContain('top-secret');
  });

  it('binds loopback only', () => {
    expect(server.url.startsWith('http://127.0.0.1:')).toBe(true);
  });

  it('returns 400 (not a crash) on a malformed percent-encoding (PR #1249 SHOULD)', async () => {
    // `GET /%` throws URIError in decodeURIComponent — the handler must catch it and 400, never crash.
    const res = await rawGet(server.url, '/%');
    expect(res.status).toBe(400);
    // the server is still alive afterward
    expect((await fetch(`${server.url}/`)).status).toBe(200);
  });

  it('rejects a non-loopback Host header (403) — DNS-rebinding defense (PR #1249 CONSIDER)', async () => {
    const res = await rawGet(server.url, '/', { host: 'evil.example.com' });
    expect(res.status).toBe(403);
    expect(res.body).not.toContain('ws-url');
  });

  it('returns 404 (not a crash) when the resolved path is a DIRECTORY (SEC-006)', async () => {
    // `existsSync` is true for a directory, so the handler fell through to `readFileSync(dir)`, which
    // throws EISDIR synchronously inside the request callback — an uncaught exception that kills the
    // whole serve host. SEC-001 treats localhost as hostile: a co-resident process must not be able to
    // DoS the running agent with a one-line `GET /assets`.
    const res = await rawGet(server.url, '/assets');
    expect(res.status).toBe(404);
    // the server must still be alive afterward
    expect((await fetch(`${server.url}/`)).status).toBe(200);
  });

  it('rejects a bare-dot path instead of crashing on webRoot itself (SEC-006)', async () => {
    // `/.` used to resolve to webRoot and reach readFileSync(<dir>) → EISDIR → uncaught crash.
    // A `.` is not a plain path segment, so it is now refused up front (403 rather than 404).
    const res = await rawGet(server.url, '/.');
    expect(res.status).toBe(403);
    expect((await fetch(`${server.url}/`)).status).toBe(200);
  });

  it('does not follow a symlink under webRoot that escapes it (SEC-006)', async () => {
    // The containment check was LEXICAL: `normalize`/`join` do not resolve symlinks, so a link
    // sitting inside webRoot satisfied `startsWith(webRoot + sep)` while `openSync` followed it
    // straight out. `escape` is an ordinary path segment, so segment validation cannot catch this —
    // only canonicalizing the resolved path can. Same class as the agent-tools path-guard escape.
    const res = await rawGet(server.url, '/escape/secret.txt');
    expect(res.status).toBe(403);
    expect(res.body).not.toContain('top-secret');
  });

  it('does not follow a symlinked FILE under webRoot (SEC-006)', async () => {
    const res = await rawGet(server.url, '/secret-link.txt');
    expect(res.status).toBe(403);
    expect(res.body).not.toContain('top-secret');
  });
});

/**
 * #3289 §3 — `--serve --open` used to print "Web monitor: <url>", naming an observability tool
 * rather than the running session the person just opened.
 */
describe('servedAtMessage (#3289 §3)', () => {
  it('says test-product Agent is open, not "Web monitor"', () => {
    expect(servedAtMessage('http://127.0.0.1:4321', createTestProductRuntime())).toBe(
      'test-product Agent is open at http://127.0.0.1:4321\n',
    );
  });

  it('never says "web monitor"', () => {
    expect(
      servedAtMessage('http://127.0.0.1:1', createTestProductRuntime()).toLowerCase(),
    ).not.toContain('monitor');
  });
});
