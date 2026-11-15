import { afterEach, describe, expect, it } from 'vitest';

import { defaultAttention } from '@robota-sdk/agent-product/personal';

import { resolveGuiRoot } from '../gui-server.js';
import { findChromium } from './browser-driver.js';
import { startHarness } from './harness.js';
import { startStandInConnector, virtualHostFetch } from './stand-in-connector.js';

import type { IHarness } from './harness.js';
import type { IStandInConnector } from './stand-in-connector.js';

const chromium = findChromium();
const MAIL_HOST = 'mail.stand-in.test';
const WORDS_LABEL = 'What should I ask you about?';
/** Runs in the page; passed as a function because the page's CSP refuses evaluated strings. */
const bodyIncludes = (text: string): boolean => document.body.innerText.includes(text);

let harness: IHarness | undefined;
let mail: IStandInConnector | undefined;
afterEach(async () => {
  await harness?.close();
  await mail?.close();
  harness = undefined;
  mail = undefined;
});

describe.skipIf(chromium === undefined || resolveGuiRoot() === undefined)(
  'what to ask about, in a real browser',
  () => {
    it('shows the words that apply, saves the person’s own, says why one was refused, goes back to the default, and the next check reads the saved words', async () => {
      mail = await startStandInConnector({
        access: 'open',
        tools: [
          {
            name: 'list_messages',
            annotations: { readOnlyHint: true },
            run: () => 'id: msg-1\nsubject: Ten recipes for the week',
          },
        ],
        publicBase: `https://${MAIL_HOST}`,
      });
      harness = await startHarness({
        gui: true,
        connectorNetwork: {
          fetch: virtualHostFetch({ [MAIL_HOST]: mail.port }),
          lookup: async () => ['203.0.113.10'],
        },
      });
      const { api, goals, runner } = {
        api: harness.capabilities.api,
        goals: harness.capabilities.goals,
        runner: () => harness!.capabilities.runner()!,
      };
      const call = async (method: string, segments: string[], body?: unknown) => {
        const answer = await api({
          method,
          path: `/${segments.join('/')}`,
          segments,
          query: new URLSearchParams(),
          body,
        });
        return { status: answer.status, body: answer.body as any };
      };
      const made = await call('POST', ['connectors'], {
        title: 'Work mail',
        kind: 'mail',
        endpoint: `https://${MAIL_HOST}/mcp`,
        auth: 'none',
      });
      const id = made.body.connector.id as string;
      await call('POST', ['connectors', id, 'sync'], { everyMinutes: 60 });
      const stored = async (): Promise<string | undefined> =>
        (await call('GET', ['connectors', id])).body.connector.attention;

      const browser = await chromium!.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.goto(harness.local.gui!.url);
        await page.fill('input[name=code]', harness.local.gui!.accessCode);
        await page.click('button[type=submit]');
        await page.waitForFunction(bodyIncludes, 'Session connected', { timeout: 15_000 });
        await page
          .getByRole('navigation', { name: 'Menu' })
          .getByRole('button', { name: 'Connectors' })
          .click();

        // The words in force are the default for mail until the person writes their own.
        const words = page.getByLabel(WORDS_LABEL);
        await words.waitFor({ timeout: 15_000 });
        expect(await words.inputValue()).toBe(defaultAttention('mail'));
        expect(await page.getByRole('button', { name: 'Save' }).isDisabled()).toBe(true);
        await page.screenshot({ path: `${harness.stateDir}/attention-default.png` });

        // Their own words are saved and kept: a page that is reloaded shows them again.
        const own = 'Ask me only about mail from my landlord, and about anything that is overdue.';
        await words.fill(own);
        await page.getByRole('button', { name: 'Save' }).click();
        await page.waitForFunction(bodyIncludes, 'Saved. The next check uses these words.', {
          timeout: 10_000,
        });
        expect(await stored()).toBe(own);
        await page.screenshot({ path: `${harness.stateDir}/attention-saved.png` });
        await page.reload();
        await page.waitForFunction(bodyIncludes, 'Session connected', { timeout: 15_000 });
        await page
          .getByRole('navigation', { name: 'Menu' })
          .getByRole('button', { name: 'Connectors' })
          .click();
        await words.waitFor({ timeout: 15_000 });
        expect(await words.inputValue()).toBe(own);
        expect(await page.locator('body').innerText()).toContain('These are your own words.');

        // A secret value is refused where the person is typing, and nothing changes.
        await words.fill('Ask me when sk-proj-abcdefghijklmnopqrstuvwx1234567890 shows up');
        await page.getByRole('button', { name: 'Save' }).click();
        await page.waitForFunction(bodyIncludes, 'contains a secret value', {
          timeout: 10_000,
        });
        expect(await stored()).toBe(own);
        expect(await words.inputValue()).toContain('sk-proj-');
        await page.screenshot({ path: `${harness.stateDir}/attention-refused.png` });

        // The next check is told the saved words, not the default.
        await words.fill(own);
        harness.model.script({ text: 'Nothing for you.' });
        const requestsBefore = harness.model.requests.length;
        const goal = (await goals.list()).find((candidate) => candidate.connectorId === id)!;
        await goals.resume(goal.id);
        await runner().runDue();
        await runner().settled();
        const told = String(
          harness.model.requests[requestsBefore]!.messages.find(
            (message) => message.role === 'system',
          )?.content,
        );
        expect(told).toContain(own);
        expect(told).not.toContain(defaultAttention('mail'));

        // And back to the default with one click.
        await page.getByRole('button', { name: 'Use the default words for Work mail' }).click();
        await page.waitForFunction(bodyIncludes, 'Back to the default words.', {
          timeout: 10_000,
        });
        expect(await stored()).toBeUndefined();
        expect(await words.inputValue()).toBe(defaultAttention('mail'));
        await page.waitForFunction(bodyIncludes, 'These are the default words for mail', {
          timeout: 10_000,
        });
      } finally {
        await browser.close();
      }
    });
  },
);
