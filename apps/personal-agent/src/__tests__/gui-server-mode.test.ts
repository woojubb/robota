import { createServer, request } from 'node:http';
import { connect } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveGuiRoot } from '../gui-server.js';
import { publicWsUrl } from '../local-mode.js';
import { findChromium } from './browser-driver.js';
import { startHarness } from './harness.js';

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IHarness } from './harness.js';

const chromium = findChromium();
const bodyIncludes = (text: string): boolean => document.body.innerText.includes(text);

let harness: IHarness | undefined;
let proxy: Server | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
  await new Promise<void>((resolve) => (proxy ? proxy.close(() => resolve()) : resolve()));
  proxy = undefined;
});

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/**
 * The reverse proxy a published agent sits behind, as the bundle's configuration routes it: `/ws/`
 * to the WebSocket port with the prefix stripped, everything else to the GUI port, the Host kept.
 */
async function startProxy(guiPort: number, wsPort: number): Promise<number> {
  const target = (url: string) =>
    url.startsWith('/ws/')
      ? { port: wsPort, path: url.slice('/ws'.length) }
      : { port: guiPort, path: url };
  proxy = createServer((req, res) => {
    const { port, path } = target(req.url ?? '/');
    const upstream = request(
      { host: '127.0.0.1', port, method: req.method, path, headers: req.headers },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
  });
  proxy.on('upgrade', (req, socket, head) => {
    const { port, path } = target(req.url ?? '/');
    const upstream = connect(port, '127.0.0.1', () => {
      const lines = [`${req.method} ${path} HTTP/1.1`];
      for (let index = 0; index < req.rawHeaders.length; index += 2)
        lines.push(`${req.rawHeaders[index]}: ${req.rawHeaders[index + 1]}`);
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  await new Promise<void>((resolve) => proxy!.listen(0, '127.0.0.1', () => resolve()));
  return (proxy.address() as AddressInfo).port;
}

describe('the page address of a published agent', () => {
  it('reaches the WebSocket through the proxy, secure when the site is', () => {
    expect(publicWsUrl('https://agent.example.com', 'a b')).toBe(
      'wss://agent.example.com/ws/?token=a%20b',
    );
    expect(publicWsUrl('http://agent.test:8080', 't')).toBe('ws://agent.test:8080/ws/?token=t');
  });
});

describe.skipIf(chromium === undefined || resolveGuiRoot() === undefined)(
  'a published agent in a real browser, through a reverse proxy',
  () => {
    it('admits the public host with its access code and chats over the proxied WebSocket', async () => {
      const [guiPort, wsPort] = [await freePort(), await freePort()];
      const proxyPort = await startProxy(guiPort, wsPort);
      const publicOrigin = `http://agent.test:${proxyPort}`;
      const accessCode = 'c'.repeat(43);
      harness = await startHarness({
        gui: true,
        server: { publicOrigin, guiPort, wsPort, accessCode },
      });
      harness.model.script({ text: 'Hello from the published agent.' });
      expect(harness.local.gui!.url).toBe(`http://127.0.0.1:${guiPort}`);

      const browser = await chromium!.launch([
        // The test host name is resolved to this machine and reached directly, never via a proxy.
        '--host-resolver-rules=MAP agent.test 127.0.0.1',
        '--no-proxy-server',
      ]);
      try {
        const page = await browser.newPage();
        await page.goto(`${publicOrigin}/`);
        await page.fill('input[name=code]', accessCode);
        await page.click('button[type=submit]');
        await page.waitForFunction(bodyIncludes, 'Session connected', { timeout: 15_000 });
        expect(page.url().startsWith(`${publicOrigin}/`)).toBe(true);
        const wsMeta = await page.getAttribute('meta[name="ws-url"]', 'content');
        expect(wsMeta).toMatch(new RegExp(`^ws://agent\\.test:${proxyPort}/ws/\\?token=`, 'u'));

        await page.locator('main textarea').first().fill('Hi');
        await page.keyboard.press('Enter');
        await page.waitForFunction(bodyIncludes, 'Hello from the published agent.', {
          timeout: 15_000,
        });

        // Another host name pointed at the same proxy is refused.
        const other = await new Promise<number>((resolve, reject) => {
          request(
            { host: '127.0.0.1', port: proxyPort, path: '/', headers: { host: 'evil.test' } },
            (res) => resolve(res.statusCode ?? 0),
          )
            .on('error', reject)
            .end();
        });
        expect(other).toBe(403);
      } finally {
        await browser.close();
      }
    });
  },
);
