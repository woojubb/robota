import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startLoopbackGuiServer } from '../index.js';

import type { ILoopbackGuiServer } from '../index.js';

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
});
