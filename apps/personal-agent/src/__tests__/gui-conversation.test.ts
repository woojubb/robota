import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { findChromium } from './browser-driver.js';
import { resolveGuiRoot } from '../gui-server.js';
import { startHarness } from './harness.js';

import type { IHarness } from './harness.js';

const chromium = findChromium();
/** Runs in the page; passed as a function because the GUI's CSP refuses evaluated strings. */
const bodyIncludes = (text: string): boolean => document.body.innerText.includes(text);
let harness: IHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

// Needs a real Chromium and the built GUI; a machine without either skips it.
describe.skipIf(chromium === undefined || resolveGuiRoot() === undefined)(
  'web GUI conversation in a real browser',
  () => {
    it('logs in with the access code, sends a message and shows the reply', async () => {
      harness = await startHarness({ gui: true });
      harness.model.script({ text: 'GUI reply from the personal agent' });
      const browser = await chromium!.launch();
      try {
        const page = await browser.newPage();
        await page.goto(harness.local.gui!.url);
        await page.fill('input[name=code]', harness.local.gui!.accessCode);
        await page.click('button[type=submit]');
        await page.waitForFunction(bodyIncludes, 'Session connected', { timeout: 15_000 });
        await page.locator('textarea').fill('Hello personal agent');
        await page.keyboard.press('Enter');
        await page.waitForFunction(bodyIncludes, 'GUI reply from the personal agent', {
          timeout: 15_000,
        });
        expect(await page.content()).toContain('scripted-model');
      } finally {
        await browser.close();
      }
    });

    it('shows what the agent learned in the library, where the person corrects, finds and forgets it', async () => {
      harness = await startHarness({ gui: true });
      harness.model.script(
        {
          tool: 'WikiRemember',
          args: {
            page: 'Mina',
            kind: 'person',
            claim: 'Mina is allergic to peanuts',
            origin: 'owner',
          },
        },
        { text: 'Noted: Mina is allergic to peanuts.' },
      );
      const browser = await chromium!.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        page.on('dialog', (dialog) => void dialog.accept());
        await page.goto(harness.local.gui!.url);
        await page.fill('input[name=code]', harness.local.gui!.accessCode);
        await page.click('button[type=submit]');
        await page.waitForFunction(bodyIncludes, 'Session connected', { timeout: 15_000 });
        await page.locator('textarea').fill('Remember that Mina is allergic to peanuts');
        await page.keyboard.press('Enter');
        await page.waitForFunction(bodyIncludes, 'Noted: Mina is allergic to peanuts.', {
          timeout: 15_000,
        });

        const menu = page.getByRole('navigation', { name: 'Menu' });
        await menu.getByRole('button', { name: 'Library' }).click();
        await page.getByRole('button', { name: 'Mina', exact: true }).click();
        await page.waitForFunction(bodyIncludes, 'You said', { timeout: 5_000 });
        expect(await page.getByRole('article').innerText()).toContain(
          'Mina is allergic to peanuts',
        );

        await page.getByRole('button', { name: 'Correct' }).click();
        await page
          .getByRole('textbox', { name: 'Corrected fact' })
          .fill('Mina is allergic to peanuts and shellfish');
        await page.getByRole('button', { name: 'Save correction' }).click();
        await page.waitForFunction(bodyIncludes, 'No longer current (1)', { timeout: 5_000 });
        await page.screenshot({ path: join(harness.stateDir, 'library.png') });

        await menu.getByRole('button', { name: 'Search' }).click();
        await page.getByRole('searchbox', { name: 'Search' }).fill('shellfish');
        await page.keyboard.press('Enter');
        await page.getByRole('button', { name: /Mina/u }).click();
        await page.waitForFunction(bodyIncludes, 'Mina is allergic to peanuts and shellfish', {
          timeout: 5_000,
        });

        await page.getByRole('button', { name: 'Forget page' }).click();
        await page.waitForFunction(bodyIncludes, 'Nothing yet', { timeout: 5_000 });
        expect(await harness.capabilities.wiki.recall('shellfish')).toBe('No wiki pages match.');

        await menu.getByRole('button', { name: 'Settings' }).click();
        await page.waitForFunction(bodyIncludes, 'Where your data lives', { timeout: 5_000 });
        expect(await page.getByRole('textbox', { name: 'Model' }).inputValue()).toBe(
          'scripted-model',
        );

        // The chat stayed mounted while other menus were open.
        await menu.getByRole('button', { name: 'Chat' }).click();
        expect(await page.locator('body').innerText()).toContain(
          'Noted: Mina is allergic to peanuts.',
        );
      } finally {
        await browser.close();
      }
    });
  },
);
