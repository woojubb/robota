import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Raw HTTP GET that sends `rawPath` verbatim (no client-side URL normalization) — to exercise the
 * traversal guard, since `fetch` collapses `../` before it reaches the server. */
function rawGet(url: string, rawPath: string): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path: rawPath, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
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
  let webRoot: string;
  let server: IMonitorUiServer;
  const wsUrl = 'ws://127.0.0.1:7070';

  beforeAll(async () => {
    webRoot = mkdtempSync(join(tmpdir(), 'monitor-ui-'));
    mkdirSync(join(webRoot, 'assets'), { recursive: true });
    writeFileSync(
      join(webRoot, 'index.html'),
      '<!DOCTYPE html><html><head><title>M</title></head><body><div id="root"></div></body></html>',
    );
    writeFileSync(join(webRoot, 'assets', 'app.js'), 'export const x = 1;');
    // a sensitive file OUTSIDE webRoot the traversal test tries to reach
    writeFileSync(join(webRoot, '..', 'secret.txt'), 'top-secret');
    server = await startMonitorUiServer(webRoot, wsUrl);
  });
  afterAll(async () => {
    await server.close();
    rmSync(webRoot, { recursive: true, force: true });
    rmSync(join(webRoot, '..', 'secret.txt'), { force: true });
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
});
