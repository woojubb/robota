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

async function open(target: IHarness): Promise<{ page: Page; close: () => Promise<void> }> {
  const browser = await chromium!.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto(target.local.gui!.url);
  await page.fill('input[name=code]', target.local.gui!.accessCode);
  await page.click('button[type=submit]');
  await page.waitForFunction(bodyIncludes, 'Session connected', { timeout: 15_000 });
  return { page, close: () => browser.close() };
}

const userMessages = (target: IHarness): string[] =>
  target.model.requests.map((request) => {
    const users = request.messages.filter((message) => message.role === 'user');
    return String(users.at(-1)?.content ?? '');
  });

describe.skipIf(chromium === undefined || resolveGuiRoot() === undefined)(
  'spaces and side chats in a real browser',
  () => {
    it('starts a chat in a space with the own instructions of the person as its first message', async () => {
      harness = await startHarness({ gui: true });
      harness.model.script(
        { text: 'Hello there.' },
        { text: 'Happy to plan the garden organically.' },
      );
      const { page, close } = await open(harness);
      try {
        // The current chat is in use, so the space opens a new one.
        await page.locator('main textarea').first().fill('Hi');
        await page.keyboard.press('Enter');
        await page.waitForFunction(bodyIncludes, 'Hello there.', { timeout: 15_000 });
        const menu = page.getByRole('navigation', { name: 'Menu' });
        await menu.getByRole('button', { name: 'Spaces' }).click();
        await page.getByRole('button', { name: 'Create space' }).click();
        const form = page.getByRole('form', { name: 'New space' });
        await form.getByRole('textbox', { name: 'Name' }).fill('Garden');
        await form
          .getByRole('textbox', { name: /How should your agent work/u })
          .fill('Organic only. No pesticides.');
        await form.getByRole('button', { name: 'Save space' }).click();
        await page.getByRole('button', { name: 'New chat in this space' }).click();
        await page.waitForFunction(bodyIncludes, 'Happy to plan the garden organically.', {
          timeout: 15_000,
        });
        expect(userMessages(harness).at(-1)).toBe(
          `Let's work in my space "Garden".\n\nOrganic only. No pesticides.`,
        );
        // It is a new chat: the earlier exchange is not part of it.
        expect(JSON.stringify(harness.model.requests.at(-1)!.messages)).not.toContain(
          'Hello there.',
        );
      } finally {
        await close();
      }
    });

    it('keeps a side chat apart from the main chat until the person brings its answer back', async () => {
      harness = await startHarness({ gui: true });
      harness.model.script(
        { text: 'Main chat answer.' },
        { text: 'Side answer: 42 guests.' },
        { text: 'Noted the guest count.' },
      );
      const { page, close } = await open(harness);
      try {
        await page.locator('main textarea').first().fill('Plan the party');
        await page.keyboard.press('Enter');
        await page.waitForFunction(bodyIncludes, 'Main chat answer.', { timeout: 15_000 });

        await page
          .getByRole('navigation', { name: 'Menu' })
          .getByRole('button', { name: 'Side chat' })
          .click();
        const side = page.getByRole('complementary', { name: 'Side chat' });
        await side.locator('textarea').fill('How many guests did we invite?');
        await side.locator('textarea').press('Enter');
        await page.waitForFunction(bodyIncludes, 'Side answer: 42 guests.', { timeout: 15_000 });
        // The side chat is its own conversation: the main chat never saw it.
        expect(JSON.stringify(harness.model.requests[1]!.messages)).not.toContain('Plan the party');

        await side.getByRole('button', { name: 'Bring back' }).click();
        await page.waitForFunction(bodyIncludes, 'Noted the guest count.', { timeout: 15_000 });
        expect(userMessages(harness).at(-1)).toBe('From my side chat:\n\nSide answer: 42 guests.');
        expect(JSON.stringify(harness.model.requests[2]!.messages)).toContain('Plan the party');
      } finally {
        await close();
      }
    });
  },
);
