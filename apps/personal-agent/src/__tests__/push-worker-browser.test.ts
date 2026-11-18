/**
 * The push worker in a real browser: the file is served as a script without a runtime credential, it
 * registers under its own stable scope, and visiting Settings
 * asks for nothing and registers nothing. A push cannot be received here, because the browser asks the person
 * before it shows a notification and its push service is a third party; what the worker does with a message
 * is checked in the page's own tests, against the same code.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { chromium as playwrightChromium } from 'playwright';

import { resolveGuiRoot } from '../gui-server.js';
import { findChromium } from './browser-driver.js';
import { startHarness } from './harness.js';

import type { IHarness } from './harness.js';

const systemChromium = process.env['CHROME_BIN'] ?? '/usr/bin/google-chrome';
const chromium =
  findChromium() ??
  (existsSync(systemChromium)
    ? {
        launch: (args: readonly string[] = []) =>
          playwrightChromium.launch({ executablePath: systemChromium, args: [...args] }),
      }
    : undefined);
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
    it('registers under a stable scope, and nothing is asked or registered before the person presses a button', async () => {
      const stateDir = mkdtempSync(join(tmpdir(), 'personal-push-browser-'));
      harness = await startHarness({ gui: true, stateDir });
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

        // The worker is the built file, served as a script without a runtime credential.
        const served = await page.evaluate(async () => {
          const response = await fetch('/push-worker.js');
          return {
            status: response.status,
            type: response.headers.get('content-type'),
            text: await response.text(),
          };
        });
        expect(served.status).toBe(200);
        expect(served.type).toMatch(/^text\/javascript/u);
        expect(served.text).toBe(built);
        const bare = await fetch(new URL('/push-worker.js', gui.url));
        expect(bare.status).toBe(200);
        expect(await bare.text()).not.toContain(
          new URL(harness.local.wsUrl).searchParams.get('token')!,
        );
        expect((await fetch(new URL(sessionPath, gui.url))).status).toBe(403);

        // The registration stays independent of the page's random session path.
        await page.evaluate(async () => {
          const registration = await navigator.serviceWorker.register('/push-worker.js', {
            scope: '/__robota_personal_push__/',
          });
          Object.assign(window, { testPushRegistration: registration });
        });
        await page.waitForFunction(
          () =>
            (window as Window & { testPushRegistration?: ServiceWorkerRegistration })
              .testPushRegistration?.active?.state === 'activated',
          undefined,
          { timeout: 15_000 },
        );
        const registered = await page.evaluate(async () => {
          const registration = (await navigator.serviceWorker.getRegistration(
            '/__robota_personal_push__/',
          ))!;
          const result = {
            scope: registration.scope,
            script: registration.active?.scriptURL,
            state: registration.active?.state,
            controlsPage: new URL('.', location.href).href === registration.scope,
            hasPush: 'pushManager' in registration,
            subscription: await registration.pushManager.getSubscription(),
          };
          return result;
        });
        expect(registered.scope).toBe(new URL('/__robota_personal_push__/', gui.url).href);
        expect(registered.script).toBe(new URL('/push-worker.js', gui.url).href);
        expect(registered.state).toBe('activated');
        expect(registered.controlsPage).toBe(false);
        expect(registered.hasPush).toBe(true);
        expect(registered.subscription).toBeNull();

        await harness.close();
        harness = undefined;
        harness = await startHarness({ gui: true, stateDir });
        const restarted = harness.local.gui!;
        expect(new URL(restarted.url).origin).toBe(new URL(gui.url).origin);
        await page.goto(restarted.url);
        await page.fill('input[name=code]', restarted.accessCode);
        await page.click('button[type=submit]');
        await page.waitForFunction(bodyIncludes, 'Session connected', { timeout: 15_000 });
        expect(new URL(page.url()).pathname).not.toBe(sessionPath);
        const retained = await page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration(
            '/__robota_personal_push__/',
          );
          const result = { scope: registration?.scope, state: registration?.active?.state };
          await registration?.unregister();
          return result;
        });
        expect(retained).toEqual({ scope: registered.scope, state: 'activated' });
        expect(await untouched()).toEqual({ permission: 'default', registrations: 0 });
      } finally {
        await browser.close();
        await harness?.close();
        harness = undefined;
        rmSync(stateDir, { recursive: true, force: true });
      }
    });
  },
);
