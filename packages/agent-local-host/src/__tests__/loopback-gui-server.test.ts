import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LOOPBACK_GUI_API_HEADER, startLoopbackGuiServer } from '../index.js';

import type { ILoopbackGuiApiRequest, ILoopbackGuiServer } from '../index.js';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

function webRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'gui-root-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><title>gui</title></head><body></body></html>');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'app.js'), 'export {};');
  const outside = mkdtempSync(join(tmpdir(), 'gui-outside-'));
  writeFileSync(join(outside, 'secret.txt'), 'secret');
  symlinkSync(join(outside, 'secret.txt'), join(root, 'assets', 'escape.txt'));
  cleanup.push(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  return root;
}

async function start(options: Partial<Parameters<typeof startLoopbackGuiServer>[0]> = {}): Promise<ILoopbackGuiServer> {
  const server = await startLoopbackGuiServer({ webRoot: webRoot(), headHtml: '<meta name="ws-url" content="ws://x/?token=t" />', ...options });
  cleanup.push(() => server.close());
  return server;
}

async function login(server: ILoopbackGuiServer, code: string): Promise<Response> {
  return fetch(new URL('/__monitor_login', server.url), { method: 'POST', body: new URLSearchParams({ code }), redirect: 'manual' });
}

describe('loopback GUI server', () => {
  it('shows the configured labels on the access-code page', async () => {
    const server = await start({ labels: { title: 'Personal agent', prompt: 'Access code', submit: 'Open <it>' } });
    const page = await (await fetch(server.url)).text();
    expect(page).toContain('<title>Personal agent</title>');
    expect(page).toContain('Access code <input');
    expect(page).toContain('Open &lt;it&gt;');
  });

  it('serves the index with the head markup only after the code, under the session path with its cookie', async () => {
    const server = await start();
    expect((await login(server, 'wrong')).status).toBe(403);
    const ok = await login(server, server.accessCode);
    expect(ok.status).toBe(303);
    const location = ok.headers.get('location')!;
    const cookie = ok.headers.get('set-cookie')!.split(';')[0]!;
    expect((await fetch(new URL(location, server.url))).status).toBe(403);
    const index = await (await fetch(new URL(location, server.url), { headers: { cookie } })).text();
    expect(index).toContain('<meta name="ws-url" content="ws://x/?token=t" />');
    expect((await fetch(new URL('/index.html', server.url))).status).toBe(403);
    expect((await fetch(new URL(`${location}assets/app.js`, server.url), { headers: { cookie } })).status).toBe(200);
  });

  it('refuses a symlink out of the web root and a non-loopback Host', async () => {
    const server = await start();
    const ok = await login(server, server.accessCode);
    const location = ok.headers.get('location')!;
    const cookie = ok.headers.get('set-cookie')!.split(';')[0]!;
    expect((await fetch(new URL(`${location}assets/escape.txt`, server.url), { headers: { cookie } })).status).toBe(403);
    const url = new URL(server.url);
    const status = await new Promise<number>((resolve) => {
      request({ host: url.hostname, port: url.port, path: '/', headers: { host: 'evil.example' } }, (res) => resolve(res.statusCode ?? 0)).end();
    });
    expect(status).toBe(403);
  });

  describe('product API', () => {
    async function session(api: NonNullable<Parameters<typeof startLoopbackGuiServer>[0]['api']>) {
      const server = await start({ api });
      const ok = await login(server, server.accessCode);
      const base = new URL(`${ok.headers.get('location')!}api/`, server.url);
      return { server, base, cookie: ok.headers.get('set-cookie')!.split(';')[0]! };
    }

    it('answers only a browser holding the access cookie, under the session path', async () => {
      const seen: ILoopbackGuiApiRequest[] = [];
      const { server, base, cookie } = await session(async (request) => {
        seen.push(request);
        return { status: 200, body: { pages: ['mina'] } };
      });
      expect((await fetch(new URL('wiki/pages', base))).status).toBe(403);
      expect((await fetch(new URL('/api/wiki/pages', server.url), { headers: { cookie } })).status).toBe(404);
      const answer = await fetch(new URL('wiki/pages/mina%20lee?kind=person', base), { headers: { cookie } });
      expect(answer.status).toBe(200);
      expect(answer.headers.get('content-type')).toContain('application/json');
      expect(await answer.json()).toEqual({ pages: ['mina'] });
      const head = await fetch(new URL('wiki/pages', base), { method: 'HEAD', headers: { cookie } });
      expect(head.status).toBe(200);
      expect(seen.map((request) => [request.method, request.path, request.segments, request.query.get('kind')])).toEqual([
        ['GET', '/wiki/pages/mina lee', ['wiki', 'pages', 'mina lee'], 'person'],
        ['GET', '/wiki/pages', ['wiki', 'pages'], null],
      ]);
    });

    it('refuses a write without the API header, so a cross-site form cannot drive it', async () => {
      const seen: unknown[] = [];
      const { base, cookie } = await session(async (request) => {
        seen.push(request.body);
        return { status: 200, body: { ok: true } };
      });
      const form = await fetch(new URL('wiki/forget', base), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: 'text=everything',
      });
      expect(form.status).toBe(403);
      const json = await fetch(new URL('wiki/forget', base), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', [LOOPBACK_GUI_API_HEADER]: '1' },
        body: JSON.stringify({ text: 'bicycle' }),
      });
      expect(json.status).toBe(200);
      expect(seen).toEqual([{ text: 'bicycle' }]);
    });

    it('turns a bad body or a failing handler into an error answer, not a crash', async () => {
      const { base, cookie } = await session(async () => {
        throw new Error('boom');
      });
      const headers = { cookie, 'content-type': 'application/json', [LOOPBACK_GUI_API_HEADER]: '1' };
      expect((await fetch(new URL('x', base), { method: 'POST', headers, body: '{not json' })).status).toBe(400);
      const failed = await fetch(new URL('x', base), { headers: { cookie } });
      expect(failed.status).toBe(500);
      expect(await failed.json()).toEqual({ error: 'internal error' });
      expect((await fetch(new URL('x', base), { headers: { cookie } })).status).toBe(500);
    });

    it('still refuses writes to everything that is not the API', async () => {
      const { base, cookie } = await session(async () => ({ status: 200, body: null }));
      const index = new URL('..', base);
      expect((await fetch(index, { method: 'POST', headers: { cookie, [LOOPBACK_GUI_API_HEADER]: '1' } })).status).toBe(405);
    });
  });
});
