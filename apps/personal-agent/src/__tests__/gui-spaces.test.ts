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
      await harness.capabilities.wiki.remember({
        pageTitle: 'Tomato beds',
        kind: 'topic',
        claim: 'Tomatoes get the south bed.',
        source: { origin: 'owner' },
      });
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
        await page
          .getByRole('combobox', { name: 'Pin a library page to Garden' })
          .selectOption({ label: 'Tomato beds' });
        await page.getByRole('button', { name: 'Unpin Tomato beds' }).waitFor();
        await page.getByRole('button', { name: 'New chat in this space' }).click();
        await page.waitForFunction(bodyIncludes, 'Happy to plan the garden organically.', {
          timeout: 15_000,
        });
        expect(userMessages(harness).at(-1)).toBe(
          `Let's work in my space "Garden".\n\nOrganic only. No pesticides.\n\n` +
            'Read these pages from my library first:\n- Tomato beds (tomato-beds)',
        );
        // It is a new chat: the earlier exchange is not part of it.
        expect(JSON.stringify(harness.model.requests.at(-1)!.messages)).not.toContain(
          'Hello there.',
        );
      } finally {
        await close();
      }
    });

    it('starts a side chat from the main chat, lists it, and brings its answer back', async () => {
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

        const menu = page.getByRole('navigation', { name: 'Menu' });
        await expect(menu.getByText('Side chats you start appear here.').count()).resolves.toBe(1);
        await menu.getByRole('button', { name: 'Side chat', exact: true }).click();
        const side = page.getByRole('complementary', { name: 'Side chat' });
        const starter = side.getByRole('form', { name: 'Start a side chat' });
        expect(
          await starter.getByRole('checkbox', { name: /main chat's latest turns/u }).isChecked(),
        ).toBe(true);
        await starter
          .getByRole('textbox', { name: 'Ask on the side' })
          .fill('How many guests did we invite?');
        await starter.getByRole('button', { name: 'Ask' }).click();
        await page.waitForFunction(bodyIncludes, 'Side answer: 42 guests.', { timeout: 15_000 });
        // The side chat is its own conversation that starts from the quoted latest turns.
        const sideRequest = harness.model.requests[1]!;
        expect(sideRequest.messages.filter((message) => message.role === 'user')).toHaveLength(1);
        expect(userMessages(harness)[1]).toBe(
          'For context, the latest turns of my main chat:\n\nMe: Plan the party\n\nYou: Main chat answer.\n\nMy question: How many guests did we invite?',
        );

        // It is listed in the menu, linked to the chat it was started beside.
        const listed = page
          .getByRole('region', { name: 'Side chats' })
          .getByRole('button', { name: 'How many guests did we invite?' });
        await listed.waitFor({ timeout: 15_000 });
        const [record] = JSON.parse(
          readFileSync(join(harness.stateDir, 'side-chats', 'side-chats.json'), 'utf8'),
        );
        expect(typeof record.parentId).toBe('string');
        expect(record.parentId).not.toBe(record.id);

        await side.getByRole('button', { name: 'Bring back' }).click();
        await page.waitForFunction(bodyIncludes, 'Noted the guest count.', { timeout: 15_000 });
        expect(userMessages(harness).at(-1)).toBe('From my side chat:\n\nSide answer: 42 guests.');
        expect(JSON.stringify(harness.model.requests[2]!.messages)).toContain('Plan the party');

        // Its session is named after the question, so the chat list tells it apart.
        await page
          .getByRole('complementary', { name: 'Side chat' })
          .getByText('Side: How many guests did we invite?')
          .first()
          .waitFor({ timeout: 15_000 });

        // Closed and reopened from the menu, it is the same conversation.
        await side.getByRole('button', { name: 'Close' }).click();
        await listed.click();
        await page
          .getByRole('complementary', { name: 'Side chat' })
          .getByText('Side answer: 42 guests.')
          .waitFor({ timeout: 15_000 });
      } finally {
        await close();
      }
    });
  },
);
