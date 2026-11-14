import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveGuiRoot } from '../gui-server.js';
import { findChromium } from './browser-driver.js';
import { toolResults } from './scripted-model.js';
import { startHarness } from './harness.js';

import type { AddressInfo } from 'node:net';
import type { IHarness } from './harness.js';

const chromium = findChromium();
/** Runs in the page; passed as a function because the page's CSP refuses evaluated strings. */
const bodyIncludes = (text: string): boolean => document.body.innerText.includes(text);

let harness: IHarness | undefined;
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await harness?.close();
  harness = undefined;
  for (const close of closers.splice(0)) await close();
});

describe.skipIf(chromium === undefined || resolveGuiRoot() === undefined)(
  'goals and the feed in a real browser',
  () => {
    it('sets up a goal, approves its purchase from the feed, and reads its report and actions', async () => {
      const orders: string[] = [];
      const shop = createServer(async (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          for await (const chunk of req) body += String(chunk);
          orders.push(body);
          res.writeHead(200, { 'content-type': 'text/html' }).end('<p>Order received</p>');
          return;
        }
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end(
            '<h1>Tickets: 40 dollars</h1><form method="post" action="/buy"><label for="q">Quantity</label><input id="q" name="qty"><button>Buy</button></form>',
          );
      });
      await new Promise<void>((resolve) => shop.listen(0, '127.0.0.1', () => resolve()));
      closers.push(() => new Promise((resolve) => shop.close(() => resolve())));
      const host = `127.0.0.1:${(shop.address() as AddressInfo).port}`;

      harness = await startHarness({ gui: true, browserAllowedHosts: [host] });
      harness.model.script(
        { tool: 'BrowserOpen', args: { url: `http://${host}/` } },
        { tool: 'BrowserType', args: { mark: 1, text: '2' } },
        { tool: 'BrowserClick', args: { mark: 2 } },
        {
          tool: 'BrowserSubmit',
          args: { id: 'submission-1', method: 'POST', url: `http://${host}/buy` },
        },
        (request) => ({
          text: `Bought two tickets. ${toolResults(request).at(-1)?.includes('Order received') ? 'Order received.' : ''}`,
        }),
      );
      const browser = await chromium!.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await page.goto(harness.local.gui!.url);
        await page.fill('input[name=code]', harness.local.gui!.accessCode);
        await page.click('button[type=submit]');
        await page.waitForFunction(bodyIncludes, 'Session connected', { timeout: 15_000 });
        const menu = page.getByRole('navigation', { name: 'Menu' });

        await menu.getByRole('button', { name: 'Goals' }).click();
        await page.getByRole('button', { name: 'New goal' }).click();
        const form = page.getByRole('form', { name: 'New goal' });
        await form.getByRole('textbox', { name: 'Title' }).fill('Concert tickets');
        await form
          .getByRole('textbox', { name: 'What should your agent do?' })
          .fill('Buy two tickets if under 50 dollars.');
        await form.getByRole('button', { name: 'Create goal' }).click();
        await page.getByRole('button', { name: 'Run now' }).click();

        await menu.getByRole('button', { name: 'Feed' }).click();
        await page.waitForFunction(bodyIncludes, `POST http://${host}/buy`, { timeout: 15_000 });
        expect(orders).toEqual([]);
        await page.getByRole('button', { name: 'Approve' }).click();
        await page.waitForFunction(bodyIncludes, 'Bought two tickets. Order received.', {
          timeout: 15_000,
        });
        expect(orders).toEqual(['qty=2']);
        await page.screenshot({ path: `${harness.stateDir}/feed.png` });

        await page.getByRole('button', { name: 'Open goal' }).first().click();
        await page.waitForFunction(bodyIncludes, 'Done · Once', { timeout: 10_000 });
        await page.getByText(/What your agent did/u).click();
        const runs = await page.getByRole('region', { name: 'Runs' }).innerText();
        expect(runs).toContain('BrowserSubmit · waiting-approval');
        expect(runs).toContain('BrowserSubmit · approved');
        expect(runs).toContain('BrowserSubmit · done');
      } finally {
        await browser.close();
      }
    });
  },
);
