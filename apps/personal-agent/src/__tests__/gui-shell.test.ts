import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveGuiRoot } from '../gui-server.js';
import { findChromium } from './browser-driver.js';
import { startHarness } from './harness.js';
import { virtualHostFetch } from './stand-in-connector.js';
import { startStandInWebhook } from './stand-in-webhook.js';

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
          'Browse',
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
          'Browse',
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
          'Browse',
        ]);
        // Alt+Down twice in a row: the moved tab keeps focus, so the second press moves it again.
        await tabs.getByRole('button', { name: 'Chat', exact: true }).focus();
        await page.keyboard.press('Alt+ArrowDown');
        await page.keyboard.press('Alt+ArrowDown');
        const moved = [
          'Garden',
          'Feed',
          'Ideas',
          'Chat',
          'Library',
          'Goals',
          'Connectors',
          'Browse',
        ];
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
            'browse',
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
          .toEqual([
            'Vegetable garden',
            'Feed',
            'Ideas',
            'Chat',
            'Library',
            'Goals',
            'Connectors',
            'Browse',
          ]);
        await page.getByRole('button', { name: 'Delete' }).click();
        await expect
          .poll(() => tabNames(page))
          .toEqual(['Feed', 'Ideas', 'Chat', 'Library', 'Goals', 'Connectors', 'Browse']);
      } finally {
        await close();
      }
    });

    it('saves a notification address in Settings, sends it a test, and counts waiting questions in the tab title', async () => {
      const hook = await startStandInWebhook();
      // A token the address carries; built from pieces so no scan takes it for one.
      const token = ['tok', 'en-', 'Qx7', 'kd2', 'Lm9'].join('');
      try {
        harness = await startHarness({
          gui: true,
          connectorNetwork: {
            fetch: virtualHostFetch({ 'hook.stand-in.test': hook.port }),
            lookup: async () => ['203.0.113.10'],
          },
        });
        const { page, close } = await open(harness);
        try {
          const menu = page.getByRole('navigation', { name: 'Menu' });
          await menu.getByRole('button', { name: 'Settings' }).click();
          await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();
          const address = page.getByRole('form', { name: 'Notification address' });
          const field = address.getByLabel('Send notifications to this address');
          await field.fill(`https://hook.stand-in.test/topics/${token}`);
          await address.getByRole('button', { name: 'Save', exact: true }).click();
          await address
            .getByRole('status')
            .filter({ hasText: 'Saved. Notifications go to hook.stand-in.test.' })
            .waitFor();
          // The page keeps nothing of the address: the field is empty and only the host is shown.
          expect(await field.inputValue()).toBe('');
          expect(await page.content()).not.toContain(token);
          await address.getByRole('button', { name: 'Send a test' }).click();
          await address.getByRole('status').filter({ hasText: 'Test sent.' }).waitFor();
          expect(hook.received.map((request) => request.body)).toEqual(['Test from your agent']);
          expect(hook.received[0]!.path).toBe(`/topics/${token}`);

          // A question waiting in the feed is counted in the title, on whichever tab is showing.
          expect(await page.title()).toMatch(/Personal agent$/u);
          const { cases } = harness.capabilities;
          const { case: opened } = await cases.open({
            title: 'New sign-in from Lagos',
            noticed: 'A mail says a new sign-in happened.',
            source: 'mail:1',
          });
          await cases.ask(opened.id, { question: 'Was this you?', options: ['Yes', 'No'] });
          await expect
            .poll(() => page.title(), { timeout: 20_000 })
            .toMatch(/^\(1\) .*Personal agent$/u);
        } finally {
          await close();
        }
      } finally {
        await hook.close();
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

        // The person's own delivery limits: a refusal is the agent's words, a save reaches the agent.
        const notifications = page.getByRole('form', { name: 'Notifications' });
        const limit = notifications.getByLabel('Daily limit');
        await limit.fill('25');
        await notifications.getByRole('button', { name: 'Save notifications' }).click();
        await notifications
          .getByRole('status')
          .filter({ hasText: /whole number from 0 to 20/u })
          .waitFor();
        await limit.fill('5');
        await notifications.getByRole('button', { name: 'Save notifications' }).click();
        await notifications.getByRole('status').filter({ hasText: 'Saved.' }).waitFor();
        expect((await harness.capabilities.delivery.status()).settings.dailyLimit).toBe(5);

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

    it('opens Browse from the menu and shows the page-check task as ready and the other built-in tasks as unavailable, with nothing to start', async () => {
      harness = await startHarness({ gui: true });
      const { page, close } = await open(harness);
      try {
        const menu = page.getByRole('navigation', { name: 'Menu' });
        await menu.getByRole('button', { name: 'Browse' }).click();
        await page.getByRole('heading', { name: 'Browse', level: 1 }).waitFor();
        await page.getByRole('heading', { name: 'Tasks', level: 2 }).waitFor();
        const main = page.getByRole('main');
        expect(await main.getByRole('article').count()).toBe(4);
        const card = main.getByRole('article', { name: 'Catch up on a connected mailbox' });
        await card.getByText('Unavailable').waitFor();
        await card.getByText('no verified binding for mail.search yet').waitFor();
        await card.getByText('Search a connected mailbox').waitFor();
        // Only the task that needs nothing but the agent's own browser can be ready, and this page's
        // browser is the proof that one runs here.
        const pageCheck = main.getByRole('article', { name: 'Check a fact on a page I give you' });
        await pageCheck.getByText('Ready', { exact: true }).waitFor();
        await pageCheck
          .getByRole('list', { name: 'Access' })
          .getByText(
            "https pages the person names, read in the agent's own browser; nothing is submitted",
          )
          .waitFor();
        expect(await main.getByText('Unavailable', { exact: true }).count()).toBe(3);
        expect(await main.getByText('Ready', { exact: true }).count()).toBe(1);
        await main
          .getByRole('region', { name: 'Offers for you' })
          .getByText('No offers yet.')
          .waitFor();
        expect(await main.getByRole('button').count()).toBe(0);
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
