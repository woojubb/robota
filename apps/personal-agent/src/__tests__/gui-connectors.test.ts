import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveGuiRoot } from '../gui-server.js';
import { findChromium } from './browser-driver.js';
import { startHarness } from './harness.js';
import { startStandInConnector, virtualHostFetch } from './stand-in-connector.js';

import type { IHarness } from './harness.js';
import type { IStandInConnector } from './stand-in-connector.js';

const chromium = findChromium();
const HOST = 'tokened.stand-in.test';
const TOKEN = 'static-token-for-standin-0001';
const REPLACEMENT = 'replacement-token-for-standin-02';
/** Runs in the page; passed as a function because the page's CSP refuses evaluated strings. */
const bodyIncludes = (text: string): boolean => document.body.innerText.includes(text);

let harness: IHarness | undefined;
let service: IStandInConnector | undefined;
afterEach(async () => {
  await harness?.close();
  await service?.close();
  harness = undefined;
  service = undefined;
});

/** The token the agent holds for a connector, read from its owner-only file. */
function heldToken(stateDir: string, id: string): string {
  const directory = join(stateDir, 'connector-tokens');
  expect(readdirSync(directory)).toEqual([`${id}.json`]);
  return (JSON.parse(readFileSync(join(directory, `${id}.json`), 'utf8')) as { token: string })
    .token;
}

describe.skipIf(chromium === undefined || resolveGuiRoot() === undefined)(
  'replacing a connected token, in a real browser',
  () => {
    it('keeps the working token and says so when the service refuses the new one, then takes one it accepts, from the card', async () => {
      service = await startStandInConnector({
        access: { token: TOKEN },
        tools: [
          {
            name: 'search_notes',
            annotations: { readOnlyHint: true },
            run: () => 'Trip to Busan on May 3.',
          },
        ],
        publicBase: `https://${HOST}`,
      });
      harness = await startHarness({
        gui: true,
        connectorNetwork: {
          fetch: virtualHostFetch({ [HOST]: service.port }),
          lookup: async () => ['203.0.113.10'],
        },
      });
      const { api } = harness.capabilities;
      const call = async (method: string, segments: string[], body?: unknown, query = '') => {
        const answer = await api({
          method,
          path: `/${segments.join('/')}`,
          segments,
          query: new URLSearchParams(query),
          body,
        });
        return { status: answer.status, body: answer.body as any };
      };
      const made = await call('POST', ['connectors'], {
        title: 'Tokened',
        kind: 'notes',
        endpoint: `https://${HOST}/mcp`,
        auth: 'token',
      });
      const id = made.body.connector.id as string;
      expect((await call('POST', ['connectors', id, 'connect'], { token: TOKEN })).status).toBe(
        200,
      );
      const { stateDir } = harness;

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

        const field = page.getByLabel('New token for Tokened');
        const replace = page.getByRole('button', { name: 'Replace token' });
        await field.waitFor({ timeout: 15_000 });
        expect(await field.getAttribute('type')).toBe('password');
        expect(await replace.isDisabled()).toBe(true);

        // A token the service does not accept: said so, and the card is as it was.
        await field.fill('a-wrong-token');
        expect(await replace.isDisabled()).toBe(false);
        await replace.click();
        await page.waitForFunction(
          bodyIncludes,
          'The service refused the new token. Your agent still uses the token it had.',
          { timeout: 10_000 },
        );
        expect(await field.inputValue()).toBe('');
        const card = page.getByRole('listitem', { name: `Tokened (${id})` });
        expect(await card.innerText()).toContain('Connected');
        expect(await card.innerText()).not.toContain('Could not connect');
        expect(heldToken(stateDir, id)).toBe(TOKEN);
        await page.screenshot({ path: `${stateDir}/token-refused.png` });

        // A token the service accepts: used from now on, and the person is told what to choose again.
        service.rotateToken(REPLACEMENT);
        await field.fill(REPLACEMENT);
        await replace.click();
        await page.waitForFunction(
          bodyIncludes,
          'The new token works and is now used. Choose again which tools case requests may use.',
          { timeout: 10_000 },
        );
        expect(await field.inputValue()).toBe('');
        expect(heldToken(stateDir, id)).toBe(REPLACEMENT);
        expect(await card.innerText()).toContain('Connected');
        await page.screenshot({ path: `${stateDir}/token-replaced.png` });
        // The agent now reaches the service with the new token.
        expect((await call('GET', ['connectors', id], undefined, 'refresh=1')).status).toBe(200);
        expect(service.authorizations.at(-1)).toBe(`Bearer ${REPLACEMENT}`);
        expect(await page.locator('body').innerText()).not.toContain(REPLACEMENT);
      } finally {
        await browser.close();
      }
    }, 60_000);
  },
);
