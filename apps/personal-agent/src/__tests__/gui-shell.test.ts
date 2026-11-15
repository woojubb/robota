import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveGuiRoot } from '../gui-server.js';
import { findChromium } from './browser-driver.js';
import { startHarness } from './harness.js';

import type { Page } from 'playwright';
import type { IHarness } from './harness.js';

const chromium = findChromium();
/** Runs in the page; passed as a function because the page's CSP refuses evaluated strings. */
const bodyIncludes = (text: string): boolean => document.body.innerText.includes(text);

let harness: IHarness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

async function open(
  target: IHarness,
  viewport = { width: 1400, height: 820 },
): Promise<{ page: Page; close: () => Promise<void> }> {
  const browser = await chromium!.launch();
  const page = await browser.newPage({ viewport });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto(target.local.gui!.url);
  await page.fill('input[name=code]', target.local.gui!.accessCode);
  await page.click('button[type=submit]');
  await page.waitForFunction(bodyIncludes, 'Session connected', { timeout: 15_000 });
  return { page, close: () => browser.close() };
}

const tabNames = async (page: Page): Promise<string[]> =>
  page
    .getByRole('navigation', { name: 'Menu' })
    .getByRole('list', { name: 'Tabs' })
    .getByRole('button')
    .allInnerTexts();

describe.skipIf(chromium === undefined || resolveGuiRoot() === undefined)(
  'the menu in a real browser',
  () => {
    it('lists tabs, spaces as tabs in the order the person chose, and keeps that order', async () => {
      harness = await startHarness({ gui: true });
      const { page, close } = await open(harness);
      try {
        const menu = page.getByRole('navigation', { name: 'Menu' });
        expect(await tabNames(page)).toEqual([
          'Chat',
          'Feed',
          'Ideas',
          'Goals',
          'Library',
          'Connectors',
        ]);
        await menu.getByText('Side chats you start appear here.').waitFor();
        await menu.getByText(/drag the tabs above to reorder them/u).waitFor();

        await menu.getByRole('button', { name: 'Create space' }).click();
        const form = page.getByRole('form', { name: 'New space' });
        await form.getByRole('textbox', { name: 'Name' }).fill('Garden');
        await form.getByRole('button', { name: 'Save space' }).click();
        await page.getByRole('heading', { name: 'Garden', level: 1 }).waitFor();
        expect(await tabNames(page)).toEqual([
          'Chat',
          'Feed',
          'Ideas',
          'Goals',
          'Library',
          'Connectors',
          'Garden',
        ]);

        // Move Library up with the keyboard, and Garden to the top by dragging.
        const tabs = menu.getByRole('list', { name: 'Tabs' });
        await tabs.getByRole('button', { name: 'Library' }).focus();
        await page.keyboard.press('Alt+ArrowUp');
        await tabs
          .getByRole('listitem')
          .filter({ hasText: 'Garden' })
          .dragTo(tabs.getByRole('listitem').filter({ hasText: 'Chat' }));
        expect(await tabNames(page)).toEqual([
          'Garden',
          'Chat',
          'Feed',
          'Ideas',
          'Library',
          'Goals',
          'Connectors',
        ]);
        // Alt+Down twice in a row: the moved tab keeps focus, so the second press moves it again.
        await tabs.getByRole('button', { name: 'Chat', exact: true }).focus();
        await page.keyboard.press('Alt+ArrowDown');
        await page.keyboard.press('Alt+ArrowDown');
        const moved = ['Garden', 'Feed', 'Ideas', 'Chat', 'Library', 'Goals', 'Connectors'];
        expect(await tabNames(page)).toEqual(moved);
        const savedTabs = () =>
          JSON.parse(readFileSync(join(harness!.stateDir, 'layout', 'layout.json'), 'utf8')).tabs;
        await expect
          .poll(savedTabs)
          .toEqual([
            expect.stringMatching(/^space:/u),
            'feed',
            'ideas',
            'chat',
            'library',
            'goals',
            'connectors',
          ]);

        // The order follows the person to a fresh page.
        await page.reload();
        // The access cookie usually survives the reload; the code page appears only if it did not.
        if ((await page.locator('input[name=code]').count()) > 0) {
          await page.fill('input[name=code]', harness.local.gui!.accessCode);
          await page.click('button[type=submit]');
        }
        await page.waitForFunction(bodyIncludes, 'Session connected', { timeout: 15_000 });
        await expect.poll(() => tabNames(page)).toEqual(moved);

        // Renaming a space renames its tab; deleting it takes it out of the tabs.
        await tabs.getByRole('button', { name: 'Garden' }).click();
        await page.getByRole('button', { name: 'Edit' }).click();
        const edit = page.getByRole('form', { name: 'Edit space' });
        await edit.getByRole('textbox', { name: 'Name' }).fill('Vegetable garden');
        await edit.getByRole('button', { name: 'Save space' }).click();
        await expect
          .poll(() => tabNames(page))
          .toEqual(['Vegetable garden', 'Feed', 'Ideas', 'Chat', 'Library', 'Goals', 'Connectors']);
        await page.getByRole('button', { name: 'Delete' }).click();
        await expect
          .poll(() => tabNames(page))
          .toEqual(['Feed', 'Ideas', 'Chat', 'Library', 'Goals', 'Connectors']);
      } finally {
        await close();
      }
    });

    it('opens settings, search and a new chat from the bottom bar', async () => {
      harness = await startHarness({ gui: true });
      harness.model.script({ text: 'First answer.' });
      await harness.capabilities.wiki.remember({
        pageTitle: 'Mina',
        kind: 'person',
        claim: 'Mina drinks green tea.',
        source: { origin: 'owner' },
      });
      const { page, close } = await open(harness);
      try {
        const menu = page.getByRole('navigation', { name: 'Menu' });
        await menu.getByRole('button', { name: 'Settings' }).click();
        await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();

        await menu.getByRole('searchbox', { name: 'Search' }).fill('green tea');
        await menu.getByRole('searchbox', { name: 'Search' }).press('Enter');
        await page.getByRole('button', { name: /Mina/u }).waitFor();

        await menu.getByRole('button', { name: 'Chat', exact: true }).click();
        await page.locator('main textarea').first().fill('Hello');
        await page.keyboard.press('Enter');
        await page.waitForFunction(bodyIncludes, 'First answer.', { timeout: 15_000 });
        await menu.getByRole('button', { name: 'New chat' }).click();
        await page.waitForFunction(
          () => !document.querySelector('main')!.innerText.includes('First answer.'),
          null,
          { timeout: 15_000 },
        );
      } finally {
        await close();
      }
    });

    it('opens the menu as a drawer at phone width', async () => {
      harness = await startHarness({ gui: true });
      const { page, close } = await open(harness, { width: 390, height: 844 });
      try {
        const menu = page.getByRole('navigation', { name: 'Menu' });
        // On screen when its right edge is past the page's left edge.
        const shown = async () => {
          const box = await menu.boundingBox();
          return box !== null && box.x + box.width > 1;
        };
        await expect.poll(shown).toBe(false);
        await page.getByRole('button', { name: 'Open menu' }).click();
        await expect.poll(shown).toBe(true);
        await menu.getByRole('button', { name: 'Feed' }).click();
        await page.getByRole('heading', { name: 'Feed', level: 1 }).waitFor();
        // Choosing a tab closes the drawer, and so does Escape.
        await expect.poll(shown).toBe(false);
        await page.getByRole('button', { name: 'Open menu' }).click();
        await expect.poll(shown).toBe(true);
        await menu.getByRole('button', { name: 'Feed' }).focus();
        await page.keyboard.press('Escape');
        await expect.poll(shown).toBe(false);
      } finally {
        await close();
      }
    });
  },
);
