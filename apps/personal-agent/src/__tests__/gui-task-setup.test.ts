import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveGuiRoot } from '../gui-server.js';
import { findChromium } from './browser-driver.js';
import { loginClient, startHarness } from './harness.js';
import { startStandInConnector, virtualHostFetch } from './stand-in-connector.js';

import type { Page } from 'playwright';
import type { IVerifiedConnectorBindingSpec } from '../task-catalog/binding-providers.js';
import type { ILaunchRecipe } from '../task-catalog/launch/recipes.js';
import type { IHarness } from './harness.js';

const chromium = findChromium();
/** Runs in the page; passed as a function because the page's CSP refuses evaluated strings. */
const bodyIncludes = (text: string): boolean => document.body.innerText.includes(text);

const HOST = 'mail.stand-in.test';
const TOKEN = ['static', 'token', 'gui', 'setup', '0001'].join('-');
const MAIL = 'Catch up on a connected mailbox';
const BOUNDARY = 'search words in the connected mailbox; nothing is sent';
const SEARCH: IVerifiedConnectorBindingSpec = {
  capability: 'mail.search',
  service: { kind: 'mail', endpointOrigin: `https://${HOST}` },
  tool: 'search_mail',
  effect: 'read-only',
  argumentBoundary: BOUNDARY,
};
const recipe: ILaunchRecipe = {
  definitionId: 'catch-up-on-mailbox',
  revision: 1,
  title: 'Catch up on a connected mailbox',
  pages: [],
  instructions: () => 'Summarise the recent mail.',
};

const harnesses: IHarness[] = [];
const closers: (() => Promise<void>)[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const started of harnesses.splice(0).reverse()) await started.close().catch(() => undefined);
  for (const close of closers.splice(0).reverse()) await close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

/** The agent over a state directory, with a stand-in mail service it can reach; started again over the same directory it is a restart. */
async function startAgent(stateDir: string, mailPort: number): Promise<IHarness> {
  const started = await startHarness({
    stateDir,
    gui: true,
    browserAvailable: () => false,
    connectorBindingSpecs: [SEARCH],
    taskLaunch: { recipes: [recipe], capabilityTools: { 'mail.search': [] } },
    connectorNetwork: {
      fetch: virtualHostFetch({ [HOST]: mailPort }),
      lookup: async () => ['203.0.113.10'],
    },
  });
  started.model.script({ text: 'Nothing needs your attention.' });
  harnesses.push(started);
  return started;
}

async function openBrowse(page: Page, started: IHarness): Promise<void> {
  await page.goto(started.local.gui!.url);
  await page.fill('input[name=code]', started.local.gui!.accessCode);
  await page.click('button[type=submit]');
  await page.waitForFunction(bodyIncludes, 'Session connected', { timeout: 15_000 });
  await page
    .getByRole('navigation', { name: 'Menu' })
    .getByRole('button', { name: 'Browse' })
    .click();
}

async function startMail() {
  const mail = await startStandInConnector({
    access: { token: TOKEN },
    tools: [{ name: 'search_mail', annotations: { readOnlyHint: true }, run: () => 'none' }],
    publicBase: `https://${HOST}`,
  });
  closers.push(mail.close);
  return mail;
}

describe.skipIf(chromium === undefined || resolveGuiRoot() === undefined)(
  'a task that needs setup, in a real browser',
  () => {
    it('keeps one waiting request across a double click and a restart, and makes one goal once the named sign-in is done', async () => {
      const stateDir = mkdtempSync(join(tmpdir(), 'personal-agent-setup-'));
      directories.push(stateDir);
      const mail = await startMail();
      const first = await startAgent(stateDir, mail.port);
      const before = await loginClient(first);
      const made = await before.send('POST', 'connectors', {
        title: 'Work mail',
        kind: 'mail',
        endpoint: `https://${HOST}/mcp`,
        auth: 'token',
      });
      expect(made.status).toBe(200);
      const connector = (made.body as { connector: { id: string } }).connector.id;

      const browser = await chromium!.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await openBrowse(page, first);
        const card = page.getByRole('article', { name: MAIL });
        await card.getByRole('button', { name: 'Start when set up' }).dblclick();
        const status = card.getByLabel('Task status');
        await status.getByText('Needs setup').waitFor({ timeout: 15_000 });
        expect(await status.innerText()).toContain(`Reconnect Work mail (${connector})`);
        await page.screenshot({ path: join(stateDir, 'waiting.png') });
        // The double click made one request, and nothing started.
        const waiting = (await before.send('GET', 'tasks/launches')).body as {
          launches: { id: string; status: string }[];
        };
        expect(waiting.launches).toHaveLength(1);
        expect(waiting.launches[0]!.status).toBe('setup');
        expect(((await before.send('GET', 'goals')).body as { goals: unknown[] }).goals).toEqual(
          [],
        );
        await page.close();
      } finally {
        await browser.close();
      }

      // The agent stops with the request waiting, and starts again over the same records.
      await first.close();
      harnesses.splice(harnesses.indexOf(first), 1);
      const second = await startAgent(stateDir, mail.port);
      const after = await loginClient(second);
      const waiting = (await after.send('GET', 'tasks/launches')).body as {
        launches: { id: string; status: string }[];
      };
      expect(waiting.launches).toHaveLength(1);
      expect(waiting.launches[0]!.status).toBe('setup');
      // The person signs in to the connector the request named.
      expect(
        (await after.send('POST', `connectors/${connector}/connect`, { token: TOKEN })).status,
      ).toBe(200);

      const again = await chromium!.launch();
      try {
        const page = await again.newPage({ viewport: { width: 1280, height: 900 } });
        await openBrowse(page, second);
        const status = page.getByRole('article', { name: MAIL }).getByLabel('Task status');
        // Reading the request moved it on, once, and the page shows the goal's run, not a waiting request.
        await status.waitFor({ timeout: 15_000 });
        await status.getByText('Needs setup').waitFor({ state: 'detached', timeout: 15_000 });
        await second.capabilities.runner()!.settled();
        for (let read = 0; read < 3; read += 1)
          expect((await after.send('GET', 'tasks/launches')).status).toBe(200);
        await page.screenshot({ path: join(stateDir, 'started.png') });
        await page.close();
      } finally {
        await again.close();
      }
      const goals = ((await after.send('GET', 'goals')).body as { goals: { id: string }[] }).goals;
      expect(goals).toHaveLength(1);
      const launch = (await after.send('GET', `tasks/launches/${waiting.launches[0]!.id}`))
        .body as {
        launch: { status: string; goalId: string };
      };
      expect(launch.launch).toMatchObject({ status: 'launched', goalId: goals[0]!.id });
      expect(second.model.requests).toHaveLength(1);
    }, 90_000);

    it('asks for a look when the account that became ready was not named, and starts on exactly the access shown', async () => {
      const stateDir = mkdtempSync(join(tmpdir(), 'personal-agent-setup-'));
      directories.push(stateDir);
      const mail = await startMail();
      const agent = await startAgent(stateDir, mail.port);
      const api = await loginClient(agent);
      const browser = await chromium!.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await openBrowse(page, agent);
        const card = page.getByRole('article', { name: MAIL });
        await card.getByRole('button', { name: 'Start when set up' }).click();
        const status = card.getByLabel('Task status');
        await status.getByText('Needs setup').waitFor({ timeout: 15_000 });
        expect(await status.innerText()).toContain('Connect a mail service');

        // A service the request did not name is connected and signed in.
        const made = await api.send('POST', 'connectors', {
          title: 'Work mail',
          kind: 'mail',
          endpoint: `https://${HOST}/mcp`,
          auth: 'token',
        });
        const connector = (made.body as { connector: { id: string } }).connector.id;
        expect(
          (await api.send('POST', `connectors/${connector}/connect`, { token: TOKEN })).status,
        ).toBe(200);

        // Nothing starts by itself; the page shows the access and waits.
        await page.reload();
        await page
          .getByRole('navigation', { name: 'Menu' })
          .getByRole('button', { name: 'Browse' })
          .click();
        const review = page.getByRole('article', { name: MAIL }).getByLabel('Task status');
        await review.getByText('Needs your look').waitFor({ timeout: 15_000 });
        const access = review.getByRole('list', { name: 'Access to confirm' });
        expect(await access.innerText()).toContain(BOUNDARY);
        expect(await access.innerText()).toContain(`account ${connector}`);
        expect(((await api.send('GET', 'goals')).body as { goals: unknown[] }).goals).toEqual([]);
        await page.screenshot({ path: join(stateDir, 'review.png') });

        await review.getByRole('button', { name: 'Start with this access' }).click();
        await review.getByText('Needs your look').waitFor({ state: 'detached', timeout: 15_000 });
        await agent.capabilities.runner()!.settled();
        const goals = ((await api.send('GET', 'goals')).body as { goals: unknown[] }).goals;
        expect(goals).toHaveLength(1);
        await page.close();
      } finally {
        await browser.close();
      }
    }, 90_000);
  },
);
