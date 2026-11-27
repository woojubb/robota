/**
 * The one page a launched run may open. The host holds the address the person named, and the run's
 * browser answers for nothing else: an address that is not that one is refused before the browser is
 * asked, a page that led somewhere else (a redirect, or a page that moved on its own) is withheld from
 * the run, and every refusal is kept for the run so the outcome cannot call such a run verified. The
 * browser here is a stand-in that counts what it was asked and gives a page to any address, so a call
 * the fence let through shows as a read; the stores, the outcome and the coordinator are real.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BrowserNavigationRefusedError } from '@robota-sdk/agent-product/personal';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EVIDENCE_RULES } from '../task-catalog/launch/evidence-rules.js';
import { createFileLaunchStore } from '../task-catalog/launch/file-store.js';
import { decideOutcome } from '../task-catalog/launch/outcome.js';
import { fencedBrowser } from '../task-catalog/launch/page-fence.js';
import { pageKey } from '../task-catalog/launch/receipts.js';
import { LAUNCH_RECIPES } from '../task-catalog/launch/recipes.js';
import { createMemoryLaunchStore } from '../task-catalog/launch/store.js';
import { LAUNCH_LIMITS } from '../task-catalog/launch/validate.js';
import {
  PAGE,
  QUESTION,
  launchIntent,
  outcomeOf,
  receipt,
  refusal,
  request,
  runOf,
  siteBrowser,
  startWorld,
} from './launch-world.js';

import type { IBrowserView, IGoal, IGoalRun } from '@robota-sdk/agent-product/personal';
import type { ILaunchOffers } from '../task-catalog/launch/coordinator.js';
import type { ILaunchStore } from '../task-catalog/launch/store.js';
import type { IPageRefusal } from '../task-catalog/launch/types.js';
import type { ISitePage, IWorldOptions } from './launch-world.js';

/** What the model is told when the fence stops a call: fixed words that carry nothing of the call. */
const REFUSED = 'Refused to open that page: this task may open only the page the person named';
/** What the person is told when a run was kept from a page other than the one named. */
const KEPT_FROM_PAGE =
  'The run was kept from a page other than the one you named, so its result cannot be confirmed.';
const NOW = new Date('2026-11-24T10:00:05.000Z');
const NAMED_TEXT = 'Free shipping on orders over 20 dollars';
const ELSEWHERE_TEXT = 'ELSEWHERE-PAGE-TEXT-7c2e';
const ELSEWHERE = 'https://other.example/pricing';
const LOGIN = 'https://example.com/login';
const REPORT = 'Yes. The page says: "Free shipping on orders over 20 dollars."';

const NAMED_SITES = (): Record<string, ISitePage> => ({ [PAGE]: { text: NAMED_TEXT } });
const namedView = (): IBrowserView => ({
  url: PAGE,
  title: 'Pricing',
  text: NAMED_TEXT,
  marks: [],
});
const elsewhereView = (): IBrowserView => ({
  url: ELSEWHERE,
  title: 'Elsewhere',
  text: ELSEWHERE_TEXT,
  marks: [],
});

/** What an address the fence would not let through was refused as. */
const unnamed = (requested?: string): IPageRefusal => ({
  kind: 'page-refused',
  tool: 'open',
  reason: 'unnamed',
  ...(requested !== undefined && { requested }),
  at: NOW.toISOString(),
});

async function refusedWith(work: Promise<unknown>): Promise<BrowserNavigationRefusedError> {
  const error = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(BrowserNavigationRefusedError);
  return error as BrowserNavigationRefusedError;
}

/** The fence around a stand-in browser, with the refusals it recorded. */
function fence(
  sites: Record<string, ISitePage> = NAMED_SITES(),
  change: {
    named?: readonly string[];
    leftOn?: IBrowserView;
    refused?: (refusal: IPageRefusal) => Promise<void>;
  } = {},
) {
  const site = siteBrowser(sites, change.leftOn === undefined ? {} : { leftOn: change.leftOn });
  const refusals: IPageRefusal[] = [];
  const port = fencedBrowser(site.port, {
    pages: new Set((change.named ?? [PAGE]).map((address) => pageKey(address)!)),
    refused:
      change.refused ??
      (async (made) => {
        refusals.push(made);
      }),
    now: () => NOW,
  });
  return { port, site, refusals };
}

const TOKEN = ['sk', 'ant', 'api03', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('-');

/** The address, and the address the refusal keeps for it (none when it is not an address that can be kept). */
const TRICKS: readonly (readonly [string, string, string | undefined])[] = [
  ['another site', ELSEWHERE, ELSEWHERE],
  ['another path', 'https://example.com/other', 'https://example.com/other'],
  ['another query', `${PAGE}?plan=pro`, `${PAGE}?plan=pro`],
  ['another port', 'https://example.com:8443/pricing', 'https://example.com:8443/pricing'],
  ['another scheme', 'http://example.com/pricing', 'http://example.com/pricing'],
  [
    'a user name that makes another host look like the named one',
    'https://example.com@evil.example/pricing',
    'https://evil.example/pricing',
  ],
  ['a user name and password on the named host', 'https://user:pw@example.com/pricing', PAGE],
  ['a trailing dot on the host', 'https://example.com./pricing', 'https://example.com./pricing'],
  [
    'a look-alike host in punycode',
    'https://exämple.com/pricing',
    'https://xn--exmple-cua.com/pricing',
  ],
  [
    'a dot-dot path that leads elsewhere',
    'https://example.com/pricing/../admin',
    'https://example.com/admin',
  ],
  ['a script address', 'javascript:alert(1)', 'javascript:alert(1)'],
  ['a data address', 'data:text/html,<h1>x</h1>', 'data:text/html,<h1>x</h1>'],
  ['a file address', 'file:///etc/passwd', 'file:///etc/passwd'],
  ['a blob address', 'blob:https://example.com/1234', 'blob:https://example.com/1234'],
  ['a blank page', 'about:blank', 'about:blank'],
  ['a relative address', '/pricing', undefined],
  ['a bare word', 'pricing', undefined],
  ['no text at all', '', undefined],
  ['a very long address', `https://example.com/${'a'.repeat(3000)}`, undefined],
  ['an address that carries a secret', `${ELSEWHERE}?key=${TOKEN}`, undefined],
];

describe('the fence around the browser a launched run reads through', () => {
  it.each(TRICKS)(
    'refuses %s before the browser is asked, and keeps the refusal',
    async (_why, raw, requested) => {
      const { port, site, refusals } = fence();
      const error = await refusedWith(port.open(raw));
      expect(error.message).toBe(REFUSED);
      expect(site.calls).toEqual([]);
      expect(refusals).toEqual([unnamed(requested)]);
    },
  );

  it.each([
    ['the address as it is', PAGE, PAGE],
    ['an upper-case host', 'HTTPS://EXAMPLE.COM/pricing', PAGE],
    ['a default port', 'https://example.com:443/pricing', PAGE],
    ['a fragment', `${PAGE}#plans`, `${PAGE}#plans`],
    ['all of them together', 'HTTPS://Example.COM:443/pricing#Plans', `${PAGE}#Plans`],
  ])(
    'opens the named page given with %s, asking the browser for its normal spelling',
    async (_how, raw, dispatched) => {
      const { port, site, refusals } = fence();
      const view = await port.open(raw);
      expect(view.text).toBe(NAMED_TEXT);
      expect(site.calls).toEqual([`open ${dispatched}`]);
      expect(refusals).toEqual([]);
    },
  );

  it('refuses a look at the current page before the run opened one, even when the browser stands on the named page', async () => {
    const { port, site, refusals } = fence(NAMED_SITES(), { leftOn: namedView() });
    const error = await refusedWith(port.view());
    expect(error.message).toBe(REFUSED);
    expect(site.calls).toEqual([]);
    expect(refusals).toEqual([
      { kind: 'page-refused', tool: 'view', reason: 'not-opened', at: NOW.toISOString() },
    ]);
  });

  it('lets the run look again at the page it opened, and a refused open does not make it forget that page', async () => {
    const { port, site } = fence();
    await port.open(PAGE);
    await refusedWith(port.open(ELSEWHERE));
    expect((await port.view()).text).toBe(NAMED_TEXT);
    expect(site.calls).toEqual([`open ${PAGE}`, 'view']);
  });

  describe.each([
    ['another page of the same site', LOGIN],
    ['another site', ELSEWHERE],
  ])('when the named page leads to %s', (_name, landing) => {
    it('withholds what it led to, names none of it, and wants a new open before any look', async () => {
      const sites: Record<string, ISitePage> = {
        [PAGE]: { text: ELSEWHERE_TEXT, landsOn: landing },
      };
      const { port, site, refusals } = fence(sites);
      const error = await refusedWith(port.open(PAGE));
      expect(error.message).toBe(REFUSED);
      expect(refusals).toEqual([
        {
          kind: 'page-refused',
          tool: 'open',
          reason: 'landed-elsewhere',
          requested: PAGE,
          address: landing,
          at: NOW.toISOString(),
        },
      ]);
      expect(JSON.stringify([error.message, refusals])).not.toContain(ELSEWHERE_TEXT);
      expect(error.message).not.toContain(landing);
      // Looking again is not allowed until the run opens a page, and the browser is not asked.
      expect((await refusedWith(port.view())).message).toBe(REFUSED);
      expect(site.calls).toEqual([`open ${PAGE}`]);
      expect(refusals.map((made) => [made.tool, made.reason])).toEqual([
        ['open', 'landed-elsewhere'],
        ['view', 'not-opened'],
      ]);
      // The site stops leading away: a new open of the named page lets the run look again.
      sites[PAGE] = { text: NAMED_TEXT };
      expect((await port.open(PAGE)).text).toBe(NAMED_TEXT);
      expect((await port.view()).text).toBe(NAMED_TEXT);
    });
  });

  it('withholds a page that moved on its own between opening and looking, and wants a new open', async () => {
    const { port, site, refusals } = fence();
    await port.open(PAGE);
    site.moveTo(elsewhereView());
    const error = await refusedWith(port.view());
    expect(error.message).toBe(REFUSED);
    expect(JSON.stringify([error.message, refusals])).not.toContain(ELSEWHERE_TEXT);
    expect(refusals).toEqual([
      {
        kind: 'page-refused',
        tool: 'view',
        reason: 'landed-elsewhere',
        address: ELSEWHERE,
        at: NOW.toISOString(),
      },
    ]);
    // The page is back where the run opened it, but a page it was led away from is not trusted again.
    site.moveTo(namedView());
    await refusedWith(port.view());
    expect(refusals.at(-1)).toMatchObject({ tool: 'view', reason: 'not-opened' });
    expect(site.calls).toEqual([`open ${PAGE}`, 'view']);
    await port.open(PAGE);
    expect((await port.view()).text).toBe(NAMED_TEXT);
  });

  it('forgets a landing when the next open does not land at all, so a look at what that left is refused', async () => {
    const { port, site } = fence();
    await port.open(PAGE);
    site.port.open = async () => {
      throw new Error('the page did not load');
    };
    await expect(port.open(PAGE)).rejects.toThrow('the page did not load');
    await refusedWith(port.view());
    expect(site.calls).toEqual([`open ${PAGE}`]);
  });

  it('refuses every other call of the port, which no reading tool makes, and keeps no refusal for them', async () => {
    const { port, site, refusals } = fence();
    await port.open(PAGE);
    site.calls.length = 0;
    for (const call of [
      () => port.click(1),
      () => port.type(1, 'x', true),
      () => port.submitHeld('submission-1', { method: 'POST', url: PAGE }),
      () => port.close(),
    ])
      expect((await refusedWith(call())).message).toBe(REFUSED);
    expect(site.calls).toEqual([]);
    expect(refusals).toEqual([]);
  });

  it('refuses everything when the request named no page', async () => {
    const { port, site, refusals } = fence(NAMED_SITES(), { named: [] });
    await refusedWith(port.open(PAGE));
    await refusedWith(port.view());
    expect(site.calls).toEqual([]);
    expect(refusals.map((made) => made.reason)).toEqual(['unnamed', 'not-opened']);
  });

  it('still refuses when the refusal cannot be kept, and says nothing of why', async () => {
    const refused = vi.fn(async () => {
      throw new Error('the disk is full');
    });
    const { port, site } = fence(NAMED_SITES(), { refused });
    const error = await refusedWith(port.open(ELSEWHERE));
    expect(error.message).toBe(REFUSED);
    expect(refused).toHaveBeenCalledTimes(1);
    expect(site.calls).toEqual([]);
  });
});

/** A started launch with its run, and the reading tools the run is given. */
async function begin(
  change: {
    sites?: Record<string, ISitePage>;
    world?: IWorldOptions;
    offers?: ILaunchOffers;
  } = {},
) {
  const site = siteBrowser(change.sites ?? NAMED_SITES());
  const world = startWorld({
    browserPort: site.port,
    ...(change.offers !== undefined && { offers: change.offers }),
    ...change.world,
  });
  const answer = await world.launches.start(request());
  const goal = (await world.goals.get(answer.goalId!))!;
  const run = await world.goals.startRun(goal.id);
  const shape = (await world.launches.shape(goal, run))!;
  const tool = (name: string) => shape.scopedTools!.find((entry) => entry.getName() === name)!;
  return {
    world,
    site,
    run,
    shape,
    goalId: goal.id,
    launchId: answer.launch.id,
    open: (url: string) =>
      tool('BrowserOpen').execute({ url }, { toolName: 'BrowserOpen', parameters: { url } }),
    view: () => tool('BrowserView').execute({}, { toolName: 'BrowserView', parameters: {} }),
    kept: async () => (await world.store.get(answer.launch.id))!.receipts,
  };
}

describe('the tools a launched run is given', () => {
  it('answer a request for another address with the refusal, ask the browser nothing, and keep the refusal for the run', async () => {
    const run = await begin();
    const result = await run.open(ELSEWHERE);
    expect(JSON.stringify(result)).toContain(REFUSED);
    expect(JSON.stringify(result)).not.toContain(ELSEWHERE_TEXT);
    expect(run.site.calls).toEqual([]);
    expect(await run.kept()).toEqual([
      {
        kind: 'page-refused',
        tool: 'open',
        reason: 'unnamed',
        requested: ELSEWHERE,
        at: '2026-11-24T10:00:00.000Z',
        runId: run.run.id,
      },
    ]);
  });

  it('keep what the run read of the named page as reads and a refusal beside them, and the run is then unverified', async () => {
    const run = await begin();
    expect(JSON.stringify(await run.open(PAGE))).toContain(NAMED_TEXT);
    expect(JSON.stringify(await run.view())).toContain(NAMED_TEXT);
    expect(JSON.stringify(await run.open(ELSEWHERE))).toContain(REFUSED);
    expect(run.site.calls).toEqual([`open ${PAGE}`, 'view']);
    expect((await run.kept())!.map((entry) => [entry.kind, entry.runId])).toEqual([
      ['page-read', run.run.id],
      ['page-read', run.run.id],
      ['page-refused', run.run.id],
    ]);
    await run.world.goals.finishRun(run.run, 'done', REPORT);
    const shown = (await run.world.launches.get(run.launchId))!;
    expect(shown).toMatchObject({ progress: 'unverified', reason: KEPT_FROM_PAGE });
    // What the card shows is what the browser read, as before: the refusal is not among it.
    expect(shown.evidence.map((read) => [read.kind, read.tool, read.address])).toEqual([
      ['page-read', 'open', PAGE],
      ['page-read', 'view', PAGE],
    ]);
    expect((await run.world.store.get(run.launchId))!.receipts).toBeUndefined();
  });

  it('withhold a page the named one led to and record no read of it, so the run is unverified', async () => {
    const run = await begin({ sites: { [PAGE]: { text: ELSEWHERE_TEXT, landsOn: LOGIN } } });
    const result = await run.open(PAGE);
    expect(JSON.stringify(result)).toContain(REFUSED);
    expect(JSON.stringify(result)).not.toContain(ELSEWHERE_TEXT);
    expect(await run.kept()).toEqual([
      expect.objectContaining({
        kind: 'page-refused',
        reason: 'landed-elsewhere',
        requested: PAGE,
        address: LOGIN,
        runId: run.run.id,
      }),
    ]);
    await run.world.goals.finishRun(run.run, 'done', REPORT);
    expect(await run.world.launches.get(run.launchId)).toMatchObject({
      progress: 'unverified',
      reason: KEPT_FROM_PAGE,
      evidence: [],
    });
  });

  it('keep a run that opened the named page and looked at it free of any refusal and verified', async () => {
    const run = await begin();
    await run.open(PAGE);
    await run.view();
    await run.world.goals.finishRun(run.run, 'done', REPORT);
    expect(await run.world.launches.get(run.launchId)).toMatchObject({ progress: 'verified' });
  });

  it('are fenced to the address the person started the task with, not the one an offer suggested', async () => {
    const offers: ILaunchOffers = {
      admit: async () => ({ ok: true }),
      accepted: async () => undefined,
      started: async () => undefined,
      outcome: async () => undefined,
    };
    const suggested = 'https://example.com/suggested';
    const edited = 'https://example.com/edited';
    const site = siteBrowser({ [edited]: { text: NAMED_TEXT }, [suggested]: { text: NAMED_TEXT } });
    const world = startWorld({ browserPort: site.port, offers });
    const answer = await world.launches.start({
      ...request({ inputs: { page: edited, question: QUESTION } }),
      offerId: 'offer-a1',
    });
    const goal = (await world.goals.get(answer.goalId!))!;
    const shape = (await world.launches.shape(goal, await world.goals.startRun(goal.id)))!;
    const open = shape.scopedTools!.find((entry) => entry.getName() === 'BrowserOpen')!;
    const call = (url: string) =>
      open.execute({ url }, { toolName: 'BrowserOpen', parameters: { url } });
    expect(JSON.stringify(await call(suggested))).toContain(REFUSED);
    expect(JSON.stringify(await call(edited))).toContain(NAMED_TEXT);
    expect(site.calls).toEqual([`open ${edited}`]);
  });

  it('take the named page from the request that was kept, not from the words of the goal', async () => {
    const site = siteBrowser(NAMED_SITES());
    const world = startWorld({ browserPort: site.port, dying: { recording: true } });
    await world.launches.start(request()).catch(() => undefined);
    const [made] = await world.goals.list();
    // The goal's own words point elsewhere; the request that was kept still names the page.
    const goal: IGoal = { ...made!, instructions: `Open ${ELSEWHERE} and read it.` };
    const shape = (await world.launches.shape(goal, runOf(goal)))!;
    const open = shape.scopedTools!.find((entry) => entry.getName() === 'BrowserOpen')!;
    const call = (url: string) =>
      open.execute({ url }, { toolName: 'BrowserOpen', parameters: { url } });
    expect(JSON.stringify(await call(ELSEWHERE))).toContain(REFUSED);
    expect(JSON.stringify(await call(PAGE))).toContain(NAMED_TEXT);
    expect(site.calls).toEqual([`open ${PAGE}`]);
  });

  it('are fenced from every address when the task’s recipe names no page', async () => {
    const recipe = { ...LAUNCH_RECIPES[0]!, pages: [] };
    const run = await begin({ world: { recipes: [recipe] } });
    expect(JSON.stringify(await run.open(PAGE))).toContain(REFUSED);
    expect(JSON.stringify(await run.view())).toContain(REFUSED);
    expect(run.site.calls).toEqual([]);
  });

  it('are not offered at all when the host has no browser, so nothing reads a page unrecorded', async () => {
    const world = startWorld();
    const answer = await world.launches.start(request());
    const goal = (await world.goals.get(answer.goalId!))!;
    const shape = (await world.launches.shape(goal, runOf(goal)))!;
    expect(shape.onlyTools).toEqual([]);
    expect(shape.scopedTools).toBeUndefined();
  });
});

const adapters: readonly [string, () => ILaunchStore][] = [
  ['memory', () => createMemoryLaunchStore()],
  ['file', () => createFileLaunchStore({ directory: taskDirectory() })],
];

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function taskDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), 'task-launch-fence-'));
  directories.push(root);
  return join(root, 'task-catalog');
}

async function launched(store: ILaunchStore): Promise<string> {
  const { id } = launchIntent(1);
  await store.reserve(launchIntent(1));
  await store.advance(id, { status: 'launched', goalId: 'goal-1' });
  return id;
}

const manyReads = async (store: ILaunchStore, id: string, runId: string, count: number) => {
  for (let n = 0; n < count; n += 1)
    await store.recordReceipt(
      id,
      'goal-1',
      runId,
      receipt({
        address: `https://example.com/page-${n}`,
        requested: `https://example.com/page-${n}`,
      }),
    );
};

describe.each(adapters)('the %s launch store with refusals', (_name, create) => {
  it('keeps a refusal for a run beside a full set of reads, which cannot crowd it out', async () => {
    const store = create();
    const id = await launched(store);
    await manyReads(store, id, 'run-1', LAUNCH_LIMITS.receipts + 5);
    expect(await store.recordReceipt(id, 'goal-1', 'run-1', refusal())).toBe(true);
    const kept = (await store.get(id))!.receipts!;
    expect(kept.filter((entry) => entry.kind === 'page-read')).toHaveLength(LAUNCH_LIMITS.receipts);
    expect(kept.filter((entry) => entry.kind === 'page-refused')).toEqual([
      { ...refusal(), runId: 'run-1' },
    ]);
  });

  it('keeps at most ten refusals of a run, and the reads keep all their room beside them', async () => {
    const store = create();
    const id = await launched(store);
    expect(LAUNCH_LIMITS.refusals).toBe(10);
    for (let n = 0; n < LAUNCH_LIMITS.refusals + 5; n += 1)
      await store.recordReceipt(
        id,
        'goal-1',
        'run-1',
        refusal({ requested: `https://elsewhere.example/page-${n}` }),
      );
    await manyReads(store, id, 'run-1', LAUNCH_LIMITS.receipts + 5);
    const kept = (await store.get(id))!.receipts!;
    expect(kept.filter((entry) => entry.kind === 'page-refused')).toHaveLength(
      LAUNCH_LIMITS.refusals,
    );
    expect(kept.filter((entry) => entry.kind === 'page-read')).toHaveLength(LAUNCH_LIMITS.receipts);
  });

  it('keeps one refusal for the same tool, reason and address, and another for another address', async () => {
    const store = create();
    const id = await launched(store);
    expect(await store.recordReceipt(id, 'goal-1', 'run-1', refusal())).toBe(true);
    expect(
      await store.recordReceipt(id, 'goal-1', 'run-1', refusal({ at: '2026-11-24T10:00:09.000Z' })),
    ).toBe(false);
    expect(
      await store.recordReceipt(
        id,
        'goal-1',
        'run-1',
        refusal({ requested: 'https://elsewhere.example/other' }),
      ),
    ).toBe(true);
    expect(
      await store.recordReceipt(
        id,
        'goal-1',
        'run-1',
        refusal({ tool: 'view', reason: 'not-opened', requested: undefined }),
      ),
    ).toBe(true);
    expect((await store.get(id))!.receipts).toHaveLength(3);
  });

  it('keeps a refusal with the run that made it, and the first receipt of a later run replaces those before it', async () => {
    const store = create();
    const id = await launched(store);
    await store.recordReceipt(id, 'goal-1', 'run-1', refusal());
    await store.recordReceipt(id, 'goal-1', 'run-1', receipt());
    expect(await store.recordReceipt(id, 'goal-1', 'run-2', receipt())).toBe(true);
    expect((await store.get(id))!.receipts).toEqual([{ ...receipt(), runId: 'run-2' }]);
    expect(await store.recordReceipt(id, 'goal-1', 'run-2', refusal())).toBe(true);
    expect((await store.get(id))!.receipts!.map((entry) => [entry.kind, entry.runId])).toEqual([
      ['page-read', 'run-2'],
      ['page-refused', 'run-2'],
    ]);
  });

  it('keeps a refusal only for a launched intent that waits for its outcome, and drops it when that is decided', async () => {
    const store = create();
    expect(await store.recordReceipt(launchIntent(1).id, 'goal-1', 'run-1', refusal())).toBe(false);
    const id = await launched(store);
    expect(await store.recordReceipt(id, 'goal-2', 'run-1', refusal())).toBe(false);
    expect(await store.recordReceipt(id, 'goal-1', 'run-1', refusal())).toBe(true);
    const decided = await store.decide(id, outcomeOf());
    expect(decided.receipts).toBeUndefined();
    expect(await store.recordReceipt(id, 'goal-1', 'run-1', refusal())).toBe(false);
  });

  it.each([
    ['a field the host does not write', { extra: 1 }, /unknown field/u],
    ['a field only a read has', { digest: 'c'.repeat(64) }, /unknown field/u],
    ['a reason the host does not give', { reason: 'granted' }, /reason must be one of/u],
    ['a tool the run does not read with', { tool: 'click' }, /tool must be one of/u],
    ['a kind the host does not make', { kind: 'page-granted' }, /unknown field/u],
    ['a time that is not one', { at: 'yesterday' }, /UTC time/u],
    [
      'an address too long to keep',
      { requested: `https://x.example/${'a'.repeat(2100)}` },
      /at most/u,
    ],
  ])('refuses a refusal with %s', async (_what, change, message) => {
    const store = create();
    const id = await launched(store);
    await expect(
      store.recordReceipt(id, 'goal-1', 'run-1', { ...refusal(), ...change } as never),
    ).rejects.toThrow(message);
    expect((await store.get(id))!.receipts).toBeUndefined();
  });

  it('refuses an outcome that carries a refusal among its evidence', async () => {
    const store = create();
    const id = await launched(store);
    await expect(store.decide(id, outcomeOf({ evidence: [refusal() as never] }))).rejects.toThrow(
      /unknown field/u,
    );
  });
});

describe('the file launch store with a refusal that was edited', () => {
  it('refuses what the host would not write, and shows nothing of the launch', async () => {
    const directory = taskDirectory();
    const store = createFileLaunchStore({ directory });
    const id = await launched(store);
    await store.recordReceipt(id, 'goal-1', 'run-1', refusal());
    const file = join(directory, 'launches.json');
    const original = readFileSync(file, 'utf8');
    const edit = (change: (record: Record<string, any>) => void): void => {
      const content = JSON.parse(original) as { launches: Record<string, any>[] };
      change(content.launches[0]!);
      writeFileSync(file, JSON.stringify(content));
    };
    for (const change of [
      (record: Record<string, any>) => (record['receipts'][0].extra = 1),
      (record: Record<string, any>) => (record['receipts'][0].kind = 'page-granted'),
      (record: Record<string, any>) => (record['receipts'][0].reason = 'granted'),
      (record: Record<string, any>) => (record['receipts'][0].tool = 'submit'),
      (record: Record<string, any>) => (record['receipts'][0].runId = 'RUN ONE'),
      (record: Record<string, any>) => (record['receipts'][0].at = 'yesterday'),
      (record: Record<string, any>) => (record['receipts'][0].requested = 7),
      (record: Record<string, any>) =>
        (record['receipts'] = Array(LAUNCH_LIMITS.refusals + 1).fill(record['receipts'][0])),
      (record: Record<string, any>) =>
        (record['receipts'] = Array(LAUNCH_LIMITS.receipts + 1).fill({
          ...receipt(),
          runId: 'run-1',
        })),
    ]) {
      writeFileSync(file, original);
      edit(change);
      expect(await store.list(), String(change)).toEqual([]);
      expect(await store.issues()).toEqual(['1 saved launch could not be read and is not shown.']);
    }
    writeFileSync(file, original);
    expect(await store.list()).toHaveLength(1);
  });
});

describe('the outcome of a run that was kept from a page', () => {
  const goal: IGoal = {
    id: 'goal-1',
    title: 'Check a fact on a page',
    instructions: 'Look at the page.',
    readOnly: true,
    launch: { id: launchIntent(1).id },
    status: 'done',
    createdAt: '2026-11-24T10:00:00.000Z',
    updatedAt: '2026-11-24T10:00:00.000Z',
  };
  const run: IGoalRun = {
    id: 'run-1',
    goalId: 'goal-1',
    startedAt: '2026-11-24T10:00:01.000Z',
    endedAt: '2026-11-24T10:00:09.000Z',
    outcome: 'done',
    report: REPORT,
    actions: [],
  };
  const read = (runId = 'run-1') => ({ ...receipt(), runId });
  const kept = (reason: IPageRefusal['reason'], runId = 'run-1') => ({
    ...refusal({ reason, ...(reason === 'not-opened' && { tool: 'view' as const }) }),
    runId,
  });
  const decide = (
    receipts: readonly (ReturnType<typeof read> | ReturnType<typeof kept>)[],
    change: { run?: IGoalRun; goal?: IGoal | undefined; rules?: typeof EVIDENCE_RULES } = {},
  ) =>
    decideOutcome({
      intent: launchIntent(1, { status: 'launched', goalId: 'goal-1', receipts }),
      goal: 'goal' in change ? change.goal : goal,
      run: change.run ?? run,
      rules: change.rules ?? EVIDENCE_RULES,
      now: NOW,
    })!;

  it('is verified when nothing was refused, as it was before', () => {
    expect(decide([read()])).toMatchObject({ state: 'verified', evidence: [receipt()] });
  });

  it.each(['unnamed', 'landed-elsewhere'] as const)(
    'is unverified with fixed words when the run was refused as %s, with the reads shown as before',
    (reason) => {
      const decided = decide([read(), kept(reason)]);
      expect(decided).toMatchObject({
        state: 'unverified',
        reason: KEPT_FROM_PAGE,
        evidence: [receipt()],
        runId: 'run-1',
        report: REPORT,
      });
      expect(decided.evidence.every((entry) => entry.kind === 'page-read')).toBe(true);
    },
  );

  it('is unverified for a refusal even when the run read nothing, and before any check of the task’s rule', () => {
    expect(decide([kept('unnamed')], { rules: [] })).toMatchObject({
      state: 'unverified',
      reason: KEPT_FROM_PAGE,
      evidence: [],
    });
  });

  it('ignores a refusal of another run, since only the run that ended the goal decides it', () => {
    expect(decide([read(), kept('unnamed', 'run-0')])).toMatchObject({ state: 'verified' });
  });

  it('is not voided by a look that came before an open, which is recorded and nothing more', () => {
    const decided = decide([read(), kept('not-opened')]);
    expect(decided).toMatchObject({ state: 'verified', evidence: [receipt()] });
  });

  it('is as the rule finds without an open when the only refusals are looks before an open', () => {
    expect(decide([kept('not-opened')])).toMatchObject({
      state: 'unverified',
      reason: 'The run finished, but nothing it read matches the page you named.',
      evidence: [],
    });
  });

  it('is failed or cancelled as the run ended, whatever was refused', () => {
    const refused = [read(), kept('unnamed')] as const;
    expect(decide(refused, { run: { ...run, outcome: 'failed' } })).toMatchObject({
      state: 'failed',
    });
    expect(decide(refused, { run: { ...run, outcome: 'interrupted' } })).toMatchObject({
      state: 'cancelled',
    });
    expect(decide(refused, { goal: undefined })).toMatchObject({ state: 'cancelled' });
  });
});
