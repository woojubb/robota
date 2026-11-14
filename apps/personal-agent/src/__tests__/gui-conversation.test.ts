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
describe.skipIf(chromium === undefined || resolveGuiRoot() === undefined)('web GUI conversation in a real browser', () => {
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
      await page.waitForFunction(bodyIncludes, 'GUI reply from the personal agent', { timeout: 15_000 });
      expect(await page.content()).toContain('scripted-model');
    } finally {
      await browser.close();
    }
  });
});
