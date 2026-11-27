import { afterEach, describe, expect, it } from 'vitest';

import { resolveGuiRoot } from '../gui-server.js';
import { findChromium } from './browser-driver.js';
import { loginClient, startHarness } from './harness.js';
import { startStandInSite } from './stand-in-site.js';

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
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(target.local.gui!.url);
  await page.fill('input[name=code]', target.local.gui!.accessCode);
  await page.click('button[type=submit]');
  await page.waitForFunction(bodyIncludes, 'Session connected', { timeout: 15_000 });
  return { page, close: () => browser.close() };
}

interface IPreferencesBody {
  preferences: {
    enabled: boolean;
    delivery: string;
    topics: string[];
    mutedTopics: string[];
    mutedSources: string[];
  };
}

describe.skipIf(chromium === undefined || resolveGuiRoot() === undefined)(
  'suggestion settings in a real browser',
  () => {
    it('mutes a topic from a card so the card goes and stays gone, and keeps what the person saves in Settings', async () => {
      const site = await startStandInSite();
      try {
        harness = await startHarness({ gui: true, browserAllowedHosts: [site.host] });
        const { capabilities } = harness;
        const api = await loginClient(harness);
        const suggest = async (
          definitionId: string,
          item: string,
          why: string,
          suggestedInputs: Record<string, string>,
        ) => {
          const answer = await capabilities.offers.proposer().propose({
            definitionId,
            definitionRevision: 1,
            source: {
              kind: 'library',
              sourceItemId: item,
              observedAt: new Date(Date.now() - 60_000).toISOString().replace(/\.\d+Z$/u, 'Z'),
            },
            basis: 'The page is in your library.',
            why,
            suggestedInputs,
          });
          if (answer.status !== 'accepted') throw new Error(answer.reason);
        };
        const RESEARCH = 'You asked whether shipping is free.';
        const PLANNING = 'Your week has two empty days.';
        for (const pageTitle of ['Returns policy', 'Week plan'])
          await capabilities.wiki.remember({
            pageTitle,
            claim: `${pageTitle} is on file.`,
            source: { origin: 'owner' },
          });
        await suggest('check-fact-on-page', 'returns-policy', RESEARCH, {
          page: `${site.origin}/shipping`,
          question: 'Is shipping free?',
        });
        await suggest('prepare-my-week', 'week-plan', PLANNING, { days: '7' });

        const { page, close } = await open(harness);
        try {
          const menu = page.getByRole('navigation', { name: 'Menu' });
          const main = page.getByRole('main');
          await menu.getByRole('button', { name: 'Browse' }).click();
          const suggested = main.getByRole('region', { name: 'Suggested for you' });
          const research = suggested.getByRole('article').filter({ hasText: RESEARCH });
          const planning = suggested.getByRole('article').filter({ hasText: PLANNING });
          await research.waitFor();
          await planning.waitFor();

          // Muting the topic takes only that card away, and the agent holds the mute.
          await research.getByRole('button', { name: 'Mute topic Research' }).click();
          await research.waitFor({ state: 'detached', timeout: 15_000 });
          await planning.waitFor();
          const held = (await api.send('GET', 'tasks/offer-preferences')).body as IPreferencesBody;
          expect(held.preferences.mutedTopics).toEqual(['research']);
          const listed = (await api.send('GET', 'tasks/offers')).body as {
            offers: { reason: string }[];
          };
          expect(listed.offers.map((entry) => entry.reason)).toEqual([PLANNING]);

          // The mute stays after the page is loaded again.
          await page.reload();
          await menu.getByRole('button', { name: 'Browse' }).click();
          await planning.waitFor();
          expect(await research.count()).toBe(0);

          // Settings shows what is muted and saves a change as the agent keeps it.
          await menu.getByRole('button', { name: 'Settings' }).click();
          const form = page.getByRole('form', { name: 'Suggestions' });
          await form.waitFor();
          expect(await form.getByLabel('Muted topics').inputValue()).toBe('research');
          await form.getByLabel('How you are told').selectOption('digest');
          await form.getByLabel('Muted topics').fill('');
          await form.getByLabel('Muted sources').fill('library');
          await form.getByRole('button', { name: 'Save suggestions' }).click();
          await form.getByText('Saved.').waitFor();
          const saved = (await api.send('GET', 'tasks/offer-preferences')).body as IPreferencesBody;
          expect(saved.preferences).toEqual({
            enabled: true,
            delivery: 'digest',
            topics: [],
            mutedTopics: [],
            mutedSources: ['library'],
          });

          // A refusal is shown in the agent's words and changes nothing it holds.
          await form.getByLabel('Muted sources').fill('not a source');
          await form.getByRole('button', { name: 'Save suggestions' }).click();
          await form.getByRole('status').filter({ hasText: /\S/u }).waitFor();
          expect(await form.getByRole('status').innerText()).not.toBe('Saved.');
          const after = (await api.send('GET', 'tasks/offer-preferences')).body as IPreferencesBody;
          expect(after.preferences.mutedSources).toEqual(['library']);
          await page.screenshot({ path: `${harness.stateDir}/suggestions.png` });
        } finally {
          await close();
        }
      } finally {
        await site.close();
      }
    }, 90_000);
  },
);
