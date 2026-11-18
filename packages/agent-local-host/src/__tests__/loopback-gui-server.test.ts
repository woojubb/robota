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

  it('keeps the GUI unavailable until its runtime markup is ready', async () => {
    let markup: string | undefined;
    const server = await start({ headHtml: () => markup });
    expect((await fetch(server.url)).status).toBe(503);
    expect((await login(server, server.accessCode)).status).toBe(503);
    markup = '<meta name="ready" content="yes">';
    const response = await login(server, server.accessCode);
    expect(response.status).toBe(303);
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    const page = await fetch(new URL(response.headers.get('location')!, server.url), { headers: { cookie } });
    expect(await page.text()).toContain('<meta name="ready" content="yes">');
  });

  it('returns an authenticated browser to a named view without allowing another origin or path', async () => {
    const server = await start();
    const page = await (await fetch(new URL('/?return=feed', server.url))).text();
    expect(page).toContain('<input type="hidden" name="return" value="feed">');

    const response = await fetch(new URL('/__monitor_login', server.url), {
      method: 'POST',
      body: new URLSearchParams({ code: server.accessCode, return: 'feed' }),
      redirect: 'manual',
    });
    expect(response.status).toBe(303);
    const location = response.headers.get('location')!;
    expect(location).toMatch(/^\/[A-Za-z0-9_-]+\/#feed$/u);
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    expect((await fetch(new URL(location, server.url))).status).toBe(403);
    expect((await fetch(new URL(location, server.url), { headers: { cookie } })).status).toBe(200);

    for (const value of ['//evil.example', 'https://evil.example', '../outside', '<script>']) {
      const loginPage = await (await fetch(new URL(`/?return=${encodeURIComponent(value)}`, server.url))).text();
      expect(loginPage).not.toContain('name="return"');
      const refused = await fetch(new URL('/__monitor_login', server.url), {
        method: 'POST',
        body: new URLSearchParams({ code: server.accessCode, return: value }),
        redirect: 'manual',
      });
      expect(refused.headers.get('location')).toMatch(/^\/[A-Za-z0-9_-]+\/$/u);
    }
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

  describe('behind a reverse proxy', () => {
    /** A request with a chosen Host header, as a proxy forwarding the public name sends it. */
    function asHost(server: ILoopbackGuiServer, host: string, init: { method?: string; path?: string; body?: string; cookie?: string } = {}) {
      const url = new URL(server.url);
      return new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }>((resolve, reject) => {
        const req = request({
          host: url.hostname,
          port: url.port,
          method: init.method ?? 'GET',
          path: init.path ?? '/',
          headers: {
            host,
            ...(init.cookie !== undefined && { cookie: init.cookie }),
            ...(init.body !== undefined && { 'content-type': 'application/x-www-form-urlencoded' }),
          },
        }, (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        });
        req.on('error', reject);
        req.end(init.body);
      });
    }

    it('admits the configured public host with a Secure cookie over https, and still refuses others', async () => {
      const code = 'k'.repeat(43);
      const server = await start({ publicOrigin: 'https://Agent.Example.com', accessCode: code });
      expect(new URL(server.url).hostname).toBe('127.0.0.1');
      expect(server.accessCode).toBe(code);
      expect((await asHost(server, 'agent.example.com')).status).toBe(200);
      expect((await asHost(server, 'agent.example.com:443')).status).toBe(200);
      expect((await asHost(server, 'evil.example')).status).toBe(403);
      expect((await asHost(server, 'agent.example.com.evil.example')).status).toBe(403);
      const login = await asHost(server, 'agent.example.com', { method: 'POST', path: '/__monitor_login', body: new URLSearchParams({ code }).toString() });
      expect(login.status).toBe(303);
      const setCookie = String(login.headers['set-cookie']);
      expect(setCookie).toMatch(/HttpOnly; SameSite=Strict; Path=\/[^;]+\/; Secure/u);
      const index = await asHost(server, 'agent.example.com', { path: String(login.headers.location), cookie: setCookie.split(';')[0]! });
      expect(index.status).toBe(200);
      expect(index.body).toContain('ws-url');
    });

    it('keeps the cookie without Secure over plain http, binds a fixed port, and refuses a short kept code', async () => {
      const probe = await start();
      const port = Number(new URL(probe.url).port);
      await probe.close();
      cleanup.pop();
      const server = await start({ publicOrigin: 'http://agent.test', port });
      expect(new URL(server.url).port).toBe(String(port));
      const login = await asHost(server, 'agent.test', { method: 'POST', path: '/__monitor_login', body: new URLSearchParams({ code: server.accessCode }).toString() });
      expect(String(login.headers['set-cookie'])).not.toContain('Secure');
      await expect(start({ accessCode: 'short' })).rejects.toThrow(/at least 32/u);
      await expect(start({ publicOrigin: 'ftp://agent.test' })).rejects.toThrow(/http or https/u);
    });
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

  describe('landing path', () => {
    const landing = (seen: URLSearchParams[] = []) => ({
      path: '/back',
      handle: async (query: URLSearchParams) => {
        seen.push(query);
        if (query.get('boom') !== null) throw new Error('secret detail');
        return { status: 200, html: '<p>Connected</p>' };
      },
    });

    it('is reached without the cookie, with the query it carries and a locked-down page', async () => {
      const seen: URLSearchParams[] = [];
      const server = await start({ landing: landing(seen) });
      const answer = await fetch(new URL('/back?code=c&state=s', server.url));
      expect(answer.status).toBe(200);
      expect(await answer.text()).toBe('<p>Connected</p>');
      expect(answer.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(answer.headers.get('x-frame-options')).toBe('DENY');
      expect(answer.headers.get('referrer-policy')).toBe('no-referrer');
      expect(seen[0]?.get('state')).toBe('s');
    });

    it('answers only a GET to exactly its path, and serves nothing else without a cookie', async () => {
      const seen: URLSearchParams[] = [];
      const server = await start({ landing: landing(seen) });
      expect((await fetch(new URL('/back', server.url), { method: 'POST' })).status).toBe(405);
      expect((await fetch(new URL('/back/more', server.url))).status).toBe(404);
      expect((await fetch(new URL('/other', server.url))).status).toBe(404);
      expect(seen).toHaveLength(0);
    });

    it('keeps the Host rule: another host does not reach the handler', async () => {
      const seen: URLSearchParams[] = [];
      const server = await start({ landing: landing(seen) });
      const answer = await new Promise<number>((resolve, reject) => {
        const target = new URL('/back?state=s', server.url);
        const outgoing = request({ host: target.hostname, port: target.port, path: '/back?state=s', headers: { host: 'evil.example' } }, (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        outgoing.on('error', reject);
        outgoing.end();
      });
      expect(answer).toBe(403);
      expect(seen).toHaveLength(0);
    });

    it('turns a failing handler into a bare 500 and an over-long request into a 414', async () => {
      const server = await start({ landing: landing() });
      const failed = await fetch(new URL('/back?boom=1', server.url));
      expect(failed.status).toBe(500);
      expect(await failed.text()).not.toContain('secret detail');
      expect((await fetch(new URL(`/back?x=${'a'.repeat(5000)}`, server.url))).status).toBe(414);
    });
  });
});
