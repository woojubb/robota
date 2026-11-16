/**
 * The push worker in a real browser: the file is served at the page's own path with a script type and only
 * to the person's own browser, it registers with exactly the page's path as its scope, and visiting Settings
 * asks for nothing and registers nothing. A push cannot be received here, because the browser asks the person
 * before it shows a notification and its push service is a third party; what the worker does with a message
 * is checked in the page's own tests, against the same code.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveGuiRoot } from '../gui-server.js';
import { findChromium } from './browser-driver.js';
import { startHarness } from './harness.js';

import type { IHarness } from './harness.js';

const chromium = findChromium();
/** Runs in the page; passed as a function because the page's CSP refuses evaluated strings. */
const bodyIncludes = (text: string): boolean => document.body.innerText.includes(text);

let harness: IHarness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe.skipIf(chromium === undefined || resolveGuiRoot() === undefined)(
  'the push worker in a real browser',
  () => {
    it('is served beside the page, registers under the page’s own path, and nothing is asked or registered before the person presses a button', async () => {
      harness = await startHarness({ gui: true });
      const gui = harness.local.gui!;
      const built = readFileSync(join(resolveGuiRoot()!, 'push-worker.js'), 'utf8');
      const browser = await chromium!.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1400, height: 820 } });
        await page.goto(gui.url);
        await page.fill('input[name=code]', gui.accessCode);
        await page.click('button[type=submit]');
        await page.waitForFunction(bodyIncludes, 'Session connected', { timeout: 15_000 });
        const sessionPath = new URL(page.url()).pathname;
        expect(sessionPath).toMatch(/^\/[\w-]+\/$/u);

        // Loading the page asked for nothing and registered nothing.
        const untouched = () =>
          page.evaluate(async () => ({
            permission: Notification.permission,
            registrations: (await navigator.serviceWorker.getRegistrations()).length,
          }));
        expect(await untouched()).toEqual({ permission: 'default', registrations: 0 });

        // Neither does opening Settings: the section is there and says it is off.
        await page
          .getByRole('navigation', { name: 'Menu' })
          .getByRole('button', { name: 'Settings' })
          .click();
        const section = page.getByRole('region', { name: 'Notifications when the page is closed' });
        await section.getByText(/^Off\./u).waitFor({ timeout: 10_000 });
        await section.getByText('0 browsers are subscribed.').waitFor();
        expect(await untouched()).toEqual({ permission: 'default', registrations: 0 });

        // The worker is the built file, served as a script from the page's own path.
        const served = await page.evaluate(async () => {
          const response = await fetch('push-worker.js');
          return {
            status: response.status,
            type: response.headers.get('content-type'),
            text: await response.text(),
          };
        });
        expect(served.status).toBe(200);
        expect(served.type).toMatch(/^text\/javascript/u);
        expect(served.text).toBe(built);
        // And only to a browser holding the person's cookie.
        const bare = await fetch(new URL('push-worker.js', page.url()));
        expect(bare.status).toBe(403);

        // It registers, and its scope is exactly the page's own path, with no header asking for more.
        const registered = await page.evaluate(async () => {
          const registration = await navigator.serviceWorker.register('push-worker.js');
          const ready = await navigator.serviceWorker.ready;
          const result = {
            scope: registration.scope,
            script: ready.active?.scriptURL,
            state: ready.active?.state,
            controlsPage: new URL('.', location.href).href === registration.scope,
            hasPush: 'pushManager' in registration,
            subscription: await registration.pushManager.getSubscription(),
          };
          await registration.unregister();
          return result;
        });
        expect(registered.scope).toBe(new URL(sessionPath, gui.url).href);
        expect(registered.script).toBe(new URL(`${sessionPath}push-worker.js`, gui.url).href);
        // `ready` resolves as soon as the worker is the active one, which is while it activates.
        expect(['activating', 'activated']).toContain(registered.state);
        expect(registered.controlsPage).toBe(true);
        expect(registered.hasPush).toBe(true);
        expect(registered.subscription).toBeNull();
        expect(await untouched()).toEqual({ permission: 'default', registrations: 0 });
      } finally {
        await browser.close();
      }
    });
  },
);
