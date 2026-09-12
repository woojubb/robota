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

import { startMonitorUiServer, type IMonitorUiServer } from '../serve-monitor-ui.js';

/**
 * GUI-007 — the CLI-served web monitor static host. Verifies: index.html gets the live `ws-url` injected, a
 * static asset is served, a missing path is 404, and a path-traversal attempt is rejected (403).
 */
describe('startMonitorUiServer (GUI-007)', () => {
  let fixtureRoot: string;
  let webRoot: string;
  let server: IMonitorUiServer;
  const wsUrl = 'ws://127.0.0.1:7070';

  beforeAll(async () => {
    fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'monitor-ui-')));
    webRoot = join(fixtureRoot, 'web');
    mkdirSync(join(webRoot, 'assets'), { recursive: true });
    writeFileSync(
      join(webRoot, 'index.html'),
      '<!DOCTYPE html><html><head><title>M</title></head><body><div id="root"></div></body></html>',
    );
    writeFileSync(join(webRoot, 'assets', 'app.js'), 'export const x = 1;');
    // a sensitive file OUTSIDE webRoot the traversal test tries to reach
    writeFileSync(join(webRoot, '..', 'secret.txt'), 'top-secret');
    // symlinks INSIDE webRoot that escape it — a lexical containment check cannot see through these
    symlinkSync(join(webRoot, '..'), join(webRoot, 'escape'));
    symlinkSync(join(webRoot, '..', 'secret.txt'), join(webRoot, 'secret-link.txt'));
    server = await startMonitorUiServer(webRoot, wsUrl);
  });
  afterAll(async () => {
    await server.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('injects the live ws-url meta into index.html', async () => {
    const res = await fetch(`${server.url}/`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(`<meta name="ws-url" content="${wsUrl}" />`);
  });

  it('serves a static asset with a JS content-type', async () => {
    const res = await fetch(`${server.url}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toContain('export const x = 1;');
  });

  it('keeps serving the startup generation after its public pointer is replaced', async () => {
    const pointer = join(fixtureRoot, 'current');
    const nextPointer = join(fixtureRoot, 'next');
    const replacement = join(fixtureRoot, 'replacement');
    mkdirSync(replacement);
    writeFileSync(join(replacement, 'index.html'), '<html>replacement</html>');
    symlinkSync(webRoot, pointer, 'junction');
    const pinnedServer = await startMonitorUiServer(pointer, wsUrl);
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
