import { afterEach, describe, expect, it } from 'vitest';

import { resolveGuiRoot } from '../gui-server.js';
import { findChromium } from './browser-driver.js';
import { toolResults } from './scripted-model.js';
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
  'cases in a real browser',
  () => {
    it('shows the question a chat turn asked as a card in the feed, answers it with a click, and shows the answer in the thread', async () => {
      harness = await startHarness({ gui: true });
      harness.model.script(
        {
          tool: 'CaseOpen',
          args: {
            title: 'New sign-in to your account',
            noticed: 'A mail from Example says a **new sign-in** happened from Seoul at 10:02.',
            source: 'mail:message-1',
          },
        },
        (request) => ({
          tool: 'CaseAsk',
          args: {
            id: /case-[a-z0-9]+/u.exec(toolResults(request).at(-1) ?? '')![0],
            question: 'Did you sign in just now?',
            options: ['Yes, it was me', 'No'],
          },
        }),
        { text: 'I asked you in your feed.' },
      );
      const browser = await chromium!.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await page.goto(harness.local.gui!.url);
        await page.fill('input[name=code]', harness.local.gui!.accessCode);
        await page.click('button[type=submit]');
        await page.waitForFunction(bodyIncludes, 'Session connected', { timeout: 15_000 });
        await page.locator('textarea').fill('Keep a case on the sign-in mail.');
        await page.keyboard.press('Enter');
        await page.waitForFunction(bodyIncludes, 'I asked you in your feed.', { timeout: 15_000 });

        const menu = page.getByRole('navigation', { name: 'Menu' });
        await menu.getByRole('button', { name: 'Feed' }).click();
        await page.waitForFunction(bodyIncludes, 'Did you sign in just now?', { timeout: 15_000 });
        // The evidence came from a mail, so it is plain text with its Markdown left literal, and the
        // question is not an approval.
        expect(await page.locator('strong', { hasText: 'new sign-in' }).count()).toBe(0);
        expect(await page.locator('body').innerText()).toContain('**new sign-in**');
        expect(await page.getByRole('button', { name: 'Approve' }).count()).toBe(0);
        await page.screenshot({ path: `${harness.stateDir}/question-card.png` });

        await page.getByRole('button', { name: 'Yes, it was me' }).click();
        await page.waitForFunction(bodyIncludes, 'You answered: Yes, it was me', {
          timeout: 10_000,
        });
        expect(await page.getByRole('button', { name: 'Yes, it was me' }).count()).toBe(0);
        const [recorded] = await harness.capabilities.cases.list();
        expect(recorded?.question).toBeUndefined();
        expect(recorded?.history.at(-1)).toEqual(
          expect.objectContaining({ kind: 'answered', text: 'Yes, it was me' }),
        );

        await page.getByRole('button', { name: 'Open thread' }).click();
        await page.waitForFunction(bodyIncludes, 'Back to feed', { timeout: 10_000 });
        const thread = await page.getByRole('list', { name: 'History' }).innerText();
        expect(thread.indexOf('Noticed')).toBeLessThan(thread.indexOf('Asked you'));
        expect(thread.indexOf('Asked you')).toBeLessThan(thread.indexOf('You answered'));
        expect(thread).toContain('Yes, it was me');
        expect(await page.locator('body').innerText()).toContain('Open · opened');
        await page.screenshot({ path: `${harness.stateDir}/case-thread.png` });

        await page.getByRole('button', { name: 'Back to feed' }).click();
        await page.waitForFunction(bodyIncludes, 'You answered: Yes, it was me', {
          timeout: 10_000,
        });
      } finally {
        await browser.close();
      }
    });
  },
);
