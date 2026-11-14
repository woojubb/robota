import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { findChromiumExecutable } from '../browser/playwright-browser.js';
import { resolveGuiRoot } from '../gui-server.js';
import { findChromium } from './browser-driver.js';
import { startHarness } from './harness.js';

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IHarness } from './harness.js';

const chromium = findChromium();
/** Runs in the page; passed as a function because the page's CSP refuses evaluated strings. */
const bodyIncludes = (text: string): boolean => document.body.innerText.includes(text);

let harness: IHarness | undefined;
let site: Server | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
  await new Promise<void>((resolve) => (site ? site.close(() => resolve()) : resolve()));
  site = undefined;
});

/** A shop page with a form that sends data, which the agent's browser holds. */
async function startShop(): Promise<{ origin: string; host: string; posts: string[] }> {
  const posts: string[] = [];
  site = createServer((req, res) => {
    if (req.method === 'POST') {
      posts.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'text/html' }).end('<p>Order received</p>');
      return;
    }
    res
      .writeHead(200, { 'content-type': 'text/html' })
      .end(
        '<!doctype html><title>Concert tickets</title><h1>Concert tickets: 30 dollars each</h1>' +
          '<form method="post" action="/buy"><label for="qty">Quantity</label><input id="qty" name="qty"><button type="submit">Buy</button></form>',
      );
  });
  await new Promise<void>((resolve) => site!.listen(0, '127.0.0.1', () => resolve()));
  const host = `127.0.0.1:${(site.address() as AddressInfo).port}`;
  return { origin: `http://${host}`, host, posts };
}

describe.skipIf(
  chromium === undefined ||
    resolveGuiRoot() === undefined ||
    findChromiumExecutable() === undefined,
)("the agent's browser panel in a real browser", () => {
  it('shows the page, what the agent did and what it holds, and stops it', async () => {
    const shop = await startShop();
    harness = await startHarness({ gui: true, browserAllowedHosts: [shop.host] });
    harness.model.script(
      { tool: 'BrowserOpen', args: { url: `${shop.origin}/` } },
      { tool: 'BrowserType', args: { mark: 1, text: '2' } },
      { tool: 'BrowserClick', args: { mark: 2 } },
      { text: 'I filled in two tickets; buying needs your approval.' },
    );
    const browser = await chromium!.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 820 } });
      await page.goto(harness.local.gui!.url);
      await page.fill('input[name=code]', harness.local.gui!.accessCode);
      await page.click('button[type=submit]');
      await page.waitForFunction(bodyIncludes, 'Session connected', { timeout: 15_000 });

      await page.getByRole('main').getByRole('button', { name: 'Agent browser' }).click();
      const panel = page.getByRole('complementary', { name: 'Agent browser' });
      await panel.getByText('Your agent has no page open.').waitFor();

      await page.locator('main textarea').first().fill('Buy two concert tickets');
      await page.keyboard.press('Enter');
      await page.waitForFunction(bodyIncludes, 'buying needs your approval', { timeout: 20_000 });

      // The held submission leaves the page where it was, not on an error page.
      await panel.getByText(`${shop.origin}/`, { exact: true }).waitFor({ timeout: 10_000 });
      await panel.getByText('Concert tickets', { exact: true }).waitFor();
      await panel.getByRole('img', { name: /What your agent sees on/u }).waitFor();
      const activity = panel.getByRole('region', { name: 'Browser activity' });
      await activity.getByText('Opened Concert tickets').waitFor();
      await activity.getByText(/Typed 1 characters into "Quantity"/u).waitFor();
      await activity.getByText(/Clicked "Buy" \(button\)/u).waitFor();
      await panel
        .getByRole('region', { name: 'Waiting to send' })
        .getByText(`${shop.origin}/buy`, { exact: false })
        .waitFor();
      expect(shop.posts).toEqual([]);

      await panel.getByRole('button', { name: 'Stop' }).click();
      await panel.getByText('Your agent has no page open.').waitFor({ timeout: 10_000 });
      await activity.getByText(/Stopped by you/u).waitFor();
      expect(shop.posts).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
