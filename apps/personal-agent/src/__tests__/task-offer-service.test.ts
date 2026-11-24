/**
 * The offers the person is shown and the door a proposal comes through: a proposal is kept only after
 * the gate, the list shows only what still passes it, the person's decisions are strict and survive a
 * restart, and a launch can ask its offer whether it may start and tell it what happened. The catalog,
 * the stores and the service are real; the services and cases the offers rest on are stand-ins.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTaskCatalog } from '../task-catalog/catalog.js';
import { createFileTaskCatalogStore } from '../task-catalog/file-store.js';
import { checkSuggestedInputs } from '../task-catalog/launch/inputs.js';
import {
  EVIDENCE_MAX_AGE_MS,
  OFFER_COOLDOWN_MS,
  OFFER_PROPOSALS_PER_DAY,
  OFFER_PROPOSALS_PER_RUN,
} from '../task-catalog/offers/gate.js';
import {
  OfferRefusedError,
  SNOOZE_MAX_MS,
  createOfferService,
} from '../task-catalog/offers/service.js';
import { createMemoryTaskCatalogStore } from '../task-catalog/store.js';
import { browserContext } from './launch-world.js';

import type { ITaskCatalogStore } from '../task-catalog/store.js';
import type { TSourceStanding } from '../task-catalog/offers/gate.js';

const DAY = 24 * 60 * 60 * 1000;
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const iso = (date: Date): string => date.toISOString().replace(/\.\d+Z$/u, 'Z');

interface IWorld {
  readonly clock: { now: Date };
  readonly store: ITaskCatalogStore;
  readonly service: ReturnType<typeof createOfferService>;
  readonly state: {
    standing: TSourceStanding;
    openCases: Set<string>;
    pages: Set<string>;
    browser: 'ready' | 'unavailable';
  };
}

/** The service over a store, with stand-ins for what the offers rest on; a store can be passed to model a restart. */
function world(
  change: { store?: ITaskCatalogStore; clock?: { now: Date }; state?: IWorld['state'] } = {},
): IWorld {
  const clock = change.clock ?? { now: new Date('2026-11-25T10:00:00Z') };
  const store = change.store ?? createMemoryTaskCatalogStore({ now: () => clock.now });
  const state = change.state ?? {
    standing: 'connected' as TSourceStanding,
    openCases: new Set<string>(),
    pages: new Set<string>(['page-trip']),
    browser: 'ready' as const,
  };
  const catalog = createTaskCatalog({
    store,
    readiness: async () => browserContext(state.browser),
  });
  let counter = 0;
  const service = createOfferService({
    catalog,
    readers: {
      connector: async () => state.standing,
      connectorTitle: async () => 'Work mail',
      libraryPage: async (id) => state.pages.has(id),
      openCase: async (connectorId, item) => state.openCases.has(`${connectorId}:${item}`),
    },
    checkInputs: (definition, suggested) =>
      checkSuggestedInputs(definition, suggested, ['page'], new Set()),
    now: () => clock.now,
    newId: () => `offer-n${(counter += 1)}`,
  });
  return { clock, store, service, state };
}

const proposal = (
  world: IWorld,
  change: Record<string, unknown> = {},
): Record<string, unknown> => ({
  definitionId: 'check-fact-on-page',
  definitionRevision: 1,
  source: {
    kind: 'connector',
    connectorId: 'connector-mail-1',
    sourceItemId: 'msg-1',
    observedAt: iso(new Date(world.clock.now.getTime() - 60_000)),
  },
  basis: 'A mail from the shop links to its return policy.',
  why: 'You asked about returns last week.',
  suggestedInputs: { page: 'https://shop.example/returns' },
  ...change,
});

const itemOf = (world: IWorld, item: string, change: Record<string, unknown> = {}) =>
  proposal(world, {
    source: {
      kind: 'connector',
      connectorId: 'connector-mail-1',
      sourceItemId: item,
      observedAt: iso(new Date(world.clock.now.getTime() - 60_000)),
    },
    ...change,
  });

const ids = (offers: readonly { readonly id: string }[]): string[] =>
  offers.map((offer) => offer.id);

describe('proposing an offer', () => {
  it('keeps an offer the gate accepts and shows it with the task’s readiness and the service’s title', async () => {
    const w = world();
    const answer = await w.service.proposer().propose(proposal(w) as never);
    expect(answer).toEqual({ status: 'accepted', offerId: 'offer-n1' });
    const { offers, setAside } = await w.service.list();
    expect(setAside).toEqual([]);
    expect(offers).toEqual([
      expect.objectContaining({
        id: 'offer-n1',
        definitionTitle: 'Check a fact on a page I give you',
        source: 'agent',
        reason: 'You asked about returns last week.',
        basis: 'A mail from the shop links to its return policy.',
        decision: 'open',
        prefilled: { page: 'https://shop.example/returns' },
        evidence: expect.objectContaining({
          kind: 'connector',
          connectorTitle: 'Work mail',
          connectorId: 'connector-mail-1',
        }),
        readiness: { state: 'ready', accesses: expect.any(Array) },
      }),
    ]);
    expect(JSON.stringify(offers)).not.toContain('dedupeKey');
    expect(JSON.stringify(offers)).not.toContain('reactions');
  });

  it('answers a refusal with the gate’s reason and keeps nothing', async () => {
    const w = world();
    const answer = await w.service
      .proposer()
      .propose(proposal(w, { definitionId: 'no-such-task' }) as never);
    expect(answer).toMatchObject({
      status: 'rejected',
      reason: expect.stringContaining('No task no-such-task'),
    });
    expect((await w.service.list()).offers).toEqual([]);
    expect(await w.store.listOffers()).toEqual([]);
  });

  it('shows an offer for a task that needs setup or is unavailable, with that state', async () => {
    const w = world({
      state: {
        standing: 'connected',
        openCases: new Set(),
        pages: new Set(),
        browser: 'unavailable',
      },
    });
    await w.service.proposer().propose(proposal(w) as never);
    const { offers } = await w.service.list();
    expect(offers[0]!.readiness).toEqual({
      state: 'unavailable',
      reason: 'the local browser is not available on this machine',
    });
  });

  it('updates the one offer for a source matter on a repeat observation, and adds no second card', async () => {
    const w = world();
    const proposer = w.service.proposer();
    await proposer.propose(proposal(w) as never);
    w.clock.now = new Date(w.clock.now.getTime() + 60 * 60_000);
    const again = await proposer.propose(
      proposal(w, { why: 'The mail came again.', basis: 'The same mail, seen again.' }) as never,
    );
    expect(again).toEqual({ status: 'accepted', offerId: 'offer-n1' });
    const { offers } = await w.service.list();
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      id: 'offer-n1',
      reason: 'The mail came again.',
      basis: 'The same mail, seen again.',
    });
    expect(Date.parse(offers[0]!.evidence!.observedAt)).toBeGreaterThan(
      Date.parse('2026-11-25T10:00:00Z'),
    );
    expect(await w.store.listOffers()).toHaveLength(1);
  });

  it('stops a run at its own bound and a day at its bound, and counts a repeat against neither', async () => {
    const w = world();
    const run = w.service.proposer({ perRun: true });
    const answers = [];
    for (let item = 1; item <= OFFER_PROPOSALS_PER_RUN + 1; item += 1)
      answers.push(await run.propose(itemOf(w, `msg-${item}`) as never));
    expect(answers.map((answer) => answer.status)).toEqual([
      'accepted',
      'accepted',
      'accepted',
      'rejected',
    ]);
    expect(answers[3]).toMatchObject({
      reason: expect.stringContaining('as many offers as it may'),
    });
    // A repeat of an item it already proposed is an update.
    const next = w.service.proposer({ perRun: true });
    expect((await next.propose(itemOf(w, 'msg-1') as never)).status).toBe('accepted');
    expect(await w.store.listOffers()).toHaveLength(OFFER_PROPOSALS_PER_RUN);
    // Another run, another day's worth: the day stops at its bound whichever run asks.
    const more = w.service.proposer({ perRun: true });
    const results = [];
    for (let item = 10; item < 10 + OFFER_PROPOSALS_PER_DAY; item += 1)
      results.push((await more.propose(itemOf(w, `msg-${item}`) as never)).status);
    expect(results.filter((status) => status === 'accepted')).toHaveLength(
      OFFER_PROPOSALS_PER_DAY - OFFER_PROPOSALS_PER_RUN,
    );
    expect((await w.store.listOffers()).length).toBe(OFFER_PROPOSALS_PER_DAY);
    // A new day makes room again.
    w.clock.now = new Date(w.clock.now.getTime() + DAY + 60_000);
    expect(
      (await w.service.proposer({ perRun: true }).propose(itemOf(w, 'msg-99') as never)).status,
    ).toBe('accepted');
  });

  it('proposes one at a time, so two runs asking together never pass the day’s bound', async () => {
    const w = world();
    const runs = Array.from({ length: 4 }, () => w.service.proposer({ perRun: true }));
    const answers = await Promise.all(
      runs.flatMap((run, index) =>
        [1, 2, 3].map((item) => run.propose(itemOf(w, `msg-${index}-${item}`) as never)),
      ),
    );
    expect(answers.filter((answer) => answer.status === 'accepted')).toHaveLength(
      OFFER_PROPOSALS_PER_DAY,
    );
    expect(await w.store.listOffers()).toHaveLength(OFFER_PROPOSALS_PER_DAY);
  });
});

describe('what the person is shown', () => {
  it('is only what still passes the gate now: the service, the evidence, an open case and the task’s revision', async () => {
    const w = world();
    const proposer = w.service.proposer();
    await proposer.propose(itemOf(w, 'msg-a') as never);
    w.clock.now = new Date(w.clock.now.getTime() + 60_000);
    await proposer.propose(itemOf(w, 'msg-b') as never);
    // Newest first: the only order the page has.
    expect(ids((await w.service.list()).offers)).toEqual(['offer-n2', 'offer-n1']);

    w.state.standing = 'not-connected';
    expect((await w.service.list()).offers).toEqual([]);
    w.state.standing = 'connected';
    expect(ids((await w.service.list()).offers)).toEqual(['offer-n2', 'offer-n1']);

    w.state.openCases.add('connector-mail-1:msg-a');
    expect(ids((await w.service.list()).offers)).toEqual(['offer-n2']);
    w.state.openCases.clear();

    w.clock.now = new Date(w.clock.now.getTime() + EVIDENCE_MAX_AGE_MS);
    expect((await w.service.list()).offers).toEqual([]);
  });

  it('leaves out an offer past its time, and keeps one the person started until then, as started', async () => {
    const w = world();
    await w.service.proposer().propose(proposal(w) as never);
    await w.store.acceptOffer('offer-n1', `launch-${'0'.repeat(8)}-0000-4000-8000-000000000000`);
    const shown = (await w.service.list()).offers;
    expect(shown).toEqual([
      expect.objectContaining({
        id: 'offer-n1',
        decision: 'accepted',
        launchId: expect.any(String),
      }),
    ]);
    expect(shown[0]!.readiness).toBeUndefined();
    w.clock.now = new Date(w.clock.now.getTime() + 8 * DAY);
    expect((await w.service.list()).offers).toEqual([]);
  });

  it('records that an offer was shown once, and that it was opened', async () => {
    const w = world();
    await w.service.proposer().propose(proposal(w) as never);
    expect((await w.store.getOffer('offer-n1'))?.reactions).toBeUndefined();
    await w.service.list();
    const shown = (await w.store.getOffer('offer-n1'))?.reactions?.shown;
    expect(shown).toBe('2026-11-25T10:00:00.000Z');
    w.clock.now = new Date(w.clock.now.getTime() + 60_000);
    await w.service.list();
    expect((await w.store.getOffer('offer-n1'))?.reactions).toEqual({ shown });
    expect((await w.service.open('offer-n1'))?.id).toBe('offer-n1');
    expect((await w.store.getOffer('offer-n1'))?.reactions).toEqual({
      shown,
      opened: '2026-11-25T10:01:00.000Z',
    });
    expect(await w.service.open('offer-nope')).toBeUndefined();
  });
});

describe('the person’s decisions', () => {
  it('dismisses an offer for good: it is set aside, a repeat is refused, and bringing it back shows it again', async () => {
    const w = world();
    const proposer = w.service.proposer();
    await proposer.propose(proposal(w) as never);
    expect(await w.service.decide('offer-n1', { decision: 'dismissed' })).toEqual({
      id: 'offer-n1',
      decision: 'dismissed',
    });
    let listed = await w.service.list();
    expect(listed.offers).toEqual([]);
    expect(ids(listed.setAside)).toEqual(['offer-n1']);
    const repeat = await proposer.propose(proposal(w) as never);
    expect(repeat).toMatchObject({
      status: 'rejected',
      reason: expect.stringContaining('dismissed'),
    });
    expect((await w.service.list()).offers).toEqual([]);
    // The same answer again keeps the first time.
    const first = (await w.store.getOffer('offer-n1'))?.reactions?.dismissed;
    w.clock.now = new Date(w.clock.now.getTime() + 60_000);
    await w.service.decide('offer-n1', { decision: 'dismissed' });
    expect((await w.store.getOffer('offer-n1'))?.reactions?.dismissed).toBe(first);

    await w.service.decide('offer-n1', { decision: 'open' });
    listed = await w.service.list();
    expect(ids(listed.offers)).toEqual(['offer-n1']);
    expect(listed.setAside).toEqual([]);
  });

  it('snoozes an offer: hidden while it lasts, still updated by what is seen again, back when it ends', async () => {
    const w = world();
    const proposer = w.service.proposer();
    await proposer.propose(proposal(w) as never);
    const until = iso(new Date(w.clock.now.getTime() + DAY));
    expect(
      await w.service.decide('offer-n1', { decision: 'snoozed', snoozedUntil: until }),
    ).toEqual({
      id: 'offer-n1',
      decision: 'snoozed',
      snoozedUntil: until,
    });
    expect((await w.service.list()).offers).toEqual([]);
    expect(ids((await w.service.list()).setAside)).toEqual(['offer-n1']);

    w.clock.now = new Date(w.clock.now.getTime() + 60 * 60_000);
    expect((await proposer.propose(proposal(w, { why: 'Seen again.' }) as never)).status).toBe(
      'accepted',
    );
    expect((await w.service.list()).offers).toEqual([]);

    w.clock.now = new Date(Date.parse(until) + 1000);
    const back = (await w.service.list()).offers;
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: 'offer-n1', reason: 'Seen again.', decision: 'open' });
    expect(back[0]!.snoozedUntil).toBeUndefined();
  });

  it('refuses what is not a person’s decision, in plain words, and changes nothing', async () => {
    const w = world();
    await w.service.proposer().propose(proposal(w) as never);
    const soon = iso(new Date(w.clock.now.getTime() + DAY));
    const bad: readonly [unknown, string, RegExp][] = [
      [{ decision: 'accepted' }, 'invalid', /decision must be one of dismissed, snoozed, open/u],
      [{ decision: 'expired' }, 'invalid', /decision must be one of/u],
      [{}, 'invalid', /decision must be one of/u],
      [{ decision: 'dismissed', launchId: 'x' }, 'invalid', /unknown field: launchId/u],
      [{ decision: 'dismissed', reactions: {} }, 'invalid', /unknown field: reactions/u],
      [{ decision: 'snoozed' }, 'invalid', /snoozedUntil must be a UTC time/u],
      [
        { decision: 'snoozed', snoozedUntil: 'tomorrow' },
        'invalid',
        /snoozedUntil must be a UTC time/u,
      ],
      [
        { decision: 'snoozed', snoozedUntil: '2026-11-25T09:00:00Z' },
        'invalid',
        /must be in the future/u,
      ],
      [
        {
          decision: 'snoozed',
          snoozedUntil: iso(new Date(w.clock.now.getTime() + SNOOZE_MAX_MS + DAY)),
        },
        'invalid',
        /within 30 days/u,
      ],
      [{ decision: 'dismissed', snoozedUntil: soon }, 'invalid', /belongs to a snooze/u],
      ['dismissed', 'invalid', /The decision must be an object/u],
    ];
    for (const [body, kind, reason] of bad) {
      const failure = await w.service.decide('offer-n1', body).catch((error: unknown) => error);
      expect(failure, JSON.stringify(body)).toBeInstanceOf(OfferRefusedError);
      expect((failure as OfferRefusedError).kind, JSON.stringify(body)).toBe(kind);
      expect((failure as OfferRefusedError).message, JSON.stringify(body)).toMatch(reason);
    }
    expect((await w.store.getOffer('offer-n1'))?.decision).toBe('open');
    expect(
      await w.service.decide('offer-nope', { decision: 'dismissed' }).catch((e) => e.kind),
    ).toBe('unknown');
  });

  it('cannot change an offer that was started or has lapsed', async () => {
    const w = world();
    await w.service.proposer().propose(itemOf(w, 'msg-a') as never);
    await w.service.proposer().propose(itemOf(w, 'msg-b') as never);
    await w.store.acceptOffer('offer-n1', `launch-${'0'.repeat(8)}-0000-4000-8000-000000000000`);
    for (const decision of ['dismissed', 'open', 'snoozed']) {
      const body =
        decision === 'snoozed'
          ? { decision, snoozedUntil: iso(new Date(w.clock.now.getTime() + DAY)) }
          : { decision };
      const failure = await w.service.decide('offer-n1', body).catch((error: unknown) => error);
      expect((failure as OfferRefusedError).kind).toBe('conflict');
      expect((failure as OfferRefusedError).message).toBe('This offer was already started.');
    }
    expect((await w.store.getOffer('offer-n1'))?.decision).toBe('accepted');
    w.clock.now = new Date(w.clock.now.getTime() + 8 * DAY);
    const lapsed = await w.service
      .decide('offer-n2', { decision: 'dismissed' })
      .catch((e: unknown) => e);
    expect((lapsed as OfferRefusedError).message).toBe('This offer has expired.');
  });

  it('keeps a lapsed offer from coming back until its cooldown is over', async () => {
    const w = world();
    const proposer = w.service.proposer();
    await proposer.propose(proposal(w) as never);
    const lapsedAt = new Date(w.clock.now.getTime() + 7 * DAY);
    w.clock.now = new Date(lapsedAt.getTime() + 60_000);
    const early = await proposer.propose(proposal(w) as never);
    expect(early).toMatchObject({ status: 'rejected', reason: expect.stringContaining('lapsed') });
    expect((await w.service.list()).offers).toEqual([]);
    w.clock.now = new Date(lapsedAt.getTime() + OFFER_COOLDOWN_MS + 60_000);
    expect((await proposer.propose(proposal(w) as never)).status).toBe('accepted');
    expect(ids((await w.service.list()).offers)).toEqual(['offer-n1']);
  });
});

describe('across a restart', () => {
  it('keeps a dismissal, a snooze, a cooldown and what was shown, since they are all in the stored offers', async () => {
    const directory = join(mkdtempSync(join(tmpdir(), 'task-offers-')), 'task-catalog');
    directories.push(directory);
    const clock = { now: new Date('2026-11-25T10:00:00Z') };
    const open = (): IWorld =>
      world({ clock, store: createFileTaskCatalogStore({ directory, now: () => clock.now }) });
    const first = open();
    const proposer = first.service.proposer();
    await proposer.propose(itemOf(first, 'msg-gone') as never);
    await proposer.propose(itemOf(first, 'msg-later') as never);
    await proposer.propose(itemOf(first, 'msg-seen') as never);
    await first.service.decide('offer-n1', { decision: 'dismissed' });
    const until = iso(new Date(clock.now.getTime() + DAY));
    await first.service.decide('offer-n2', { decision: 'snoozed', snoozedUntil: until });
    await first.service.list();

    const second = open();
    const listed = await second.service.list();
    expect(ids(listed.offers)).toEqual(['offer-n3']);
    expect(ids(listed.setAside)).toEqual(['offer-n1', 'offer-n2']);
    expect((await second.store.getOffer('offer-n3'))?.reactions?.shown).toBeDefined();
    const again = second.service.proposer();
    // The dismissal holds, and the snooze holds while the observation updates the offer.
    expect(await again.propose(itemOf(second, 'msg-gone') as never)).toMatchObject({
      status: 'rejected',
      reason: expect.stringContaining('dismissed'),
    });
    expect((await again.propose(itemOf(second, 'msg-later') as never)).status).toBe('accepted');
    expect(ids((await second.service.list()).offers)).toEqual(['offer-n3']);

    // The cooldown after a lapse is the same, a restart later.
    clock.now = new Date(clock.now.getTime() + 7 * DAY + 60_000);
    const third = open();
    expect(
      await third.service.proposer().propose(itemOf(third, 'msg-seen') as never),
    ).toMatchObject({
      status: 'rejected',
      reason: expect.stringContaining('lapsed'),
    });
  });
});

describe('what a launch asks of its offer', () => {
  const launchId = `launch-${'1'.repeat(8)}-0000-4000-8000-000000000000`;

  async function start() {
    const w = world();
    await w.service.proposer().propose(proposal(w) as never);
    const catalog = createTaskCatalog({
      store: w.store,
      readiness: async () => browserContext('ready'),
    });
    const definition = (await catalog.getDefinition('check-fact-on-page'))!;
    return { w, definition };
  }

  it('admits an open offer for its own task while the gate holds', async () => {
    const { w, definition } = await start();
    expect(await w.service.launch.admit('offer-n1', definition)).toEqual({ ok: true });
  });

  it.each([
    ['one that does not exist', 'offer-zz', {}, 'unknown', /no such offer/u],
    ['one for another task', 'offer-n1', { other: true }, 'invalid', /for another task/u],
  ])('refuses %s', async (_name, id, change, kind, reason) => {
    const { w, definition } = await start();
    const other = 'other' in change ? { ...definition, id: 'prepare-my-week' } : definition;
    expect(await w.service.launch.admit(id, other)).toMatchObject({
      ok: false,
      kind,
      reason: expect.stringMatching(reason),
    });
  });

  it.each([
    [
      'dismissed',
      async (w: IWorld) => w.service.decide('offer-n1', { decision: 'dismissed' }),
      /dismissed this offer/u,
    ],
    [
      'snoozed',
      async (w: IWorld) =>
        w.service.decide('offer-n1', {
          decision: 'snoozed',
          snoozedUntil: iso(new Date(w.clock.now.getTime() + DAY)),
        }),
      /set this offer aside until later/u,
    ],
    ['started', async (w: IWorld) => w.store.acceptOffer('offer-n1', launchId), /already started/u],
    [
      'lapsed',
      async (w: IWorld) => {
        w.clock.now = new Date(w.clock.now.getTime() + 8 * DAY);
      },
      /has expired/u,
    ],
    [
      'resting on a service that was disconnected',
      async (w: IWorld) => {
        w.state.standing = 'not-connected';
      },
      /not connected right now/u,
    ],
    [
      'resting on evidence that went stale',
      async (w: IWorld) => {
        w.clock.now = new Date(w.clock.now.getTime() + EVIDENCE_MAX_AGE_MS);
      },
      /(expired|read too long ago)/u,
    ],
    [
      'about an item a case is now open on',
      async (w: IWorld) => {
        w.state.openCases.add('connector-mail-1:msg-1');
      },
      /case about this item is open/u,
    ],
  ])('refuses an offer that is %s, with the reason', async (_name, change, reason) => {
    const { w, definition } = await start();
    await change(w);
    expect(await w.service.launch.admit('offer-n1', definition)).toMatchObject({
      ok: false,
      kind: 'conflict',
      reason: expect.stringMatching(reason),
    });
  });

  it('refuses an offer for an older revision of the task', async () => {
    const { w, definition } = await start();
    const catalog = createTaskCatalog({
      store: w.store,
      builtIn: [{ ...definition, revision: 2 }],
      readiness: async () => browserContext('ready'),
    });
    const newer = createOfferService({
      catalog,
      readers: {
        connector: async () => 'connected',
        connectorTitle: async () => undefined,
        libraryPage: async () => true,
        openCase: async () => false,
      },
      checkInputs: () => ({}),
      now: () => w.clock.now,
    });
    expect(await newer.launch.admit('offer-n1', { ...definition, revision: 2 })).toMatchObject({
      ok: false,
      kind: 'conflict',
      reason: expect.stringContaining('older version of the task'),
    });
  });

  it('records the start as acceptance with the launch, then the run and its outcome apart from it', async () => {
    const { w } = await start();
    await w.service.launch.accepted('offer-n1', launchId);
    expect(await w.store.getOffer('offer-n1')).toMatchObject({
      decision: 'accepted',
      launchId,
      reactions: { accepted: '2026-11-25T10:00:00.000Z' },
    });
    await w.service.launch.started('offer-n1');
    await w.service.launch.outcome('offer-n1', 'unverified');
    let reactions = (await w.store.getOffer('offer-n1'))?.reactions;
    expect(reactions?.started).toBeDefined();
    expect(reactions?.outcome).toEqual({ state: 'unverified', at: '2026-11-25T10:00:00.000Z' });
    // Accepted but unfinished work is not success: nothing marks it verified.
    expect(reactions).not.toHaveProperty('verified');
    // The outcome is decided once.
    w.clock.now = new Date(w.clock.now.getTime() + 60_000);
    await w.service.launch.outcome('offer-n1', 'verified');
    reactions = (await w.store.getOffer('offer-n1'))?.reactions;
    expect(reactions?.outcome?.state).toBe('unverified');
    expect(reactions).not.toHaveProperty('verified');
  });

  it('records a verified outcome as verified', async () => {
    const { w } = await start();
    await w.service.launch.accepted('offer-n1', launchId);
    await w.service.launch.outcome('offer-n1', 'verified');
    expect((await w.store.getOffer('offer-n1'))?.reactions).toMatchObject({
      verified: '2026-11-25T10:00:00.000Z',
      outcome: { state: 'verified' },
    });
  });

  it('keeps the first launch of an offer, so a repeated record changes nothing', async () => {
    const { w } = await start();
    await w.service.launch.accepted('offer-n1', launchId);
    await w.service.launch.accepted(
      'offer-n1',
      `launch-${'2'.repeat(8)}-0000-4000-8000-000000000000`,
    );
    expect((await w.store.getOffer('offer-n1'))?.launchId).toBe(launchId);
  });
});
