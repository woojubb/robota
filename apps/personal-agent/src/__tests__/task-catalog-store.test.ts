import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BUILT_IN_DEFINITIONS } from '../task-catalog/built-in.js';
import { TaskCatalogRefusedError } from '../task-catalog/fields.js';
import { createFileTaskCatalogStore } from '../task-catalog/file-store.js';
import { MAX_OFFERS, putOfferInto } from '../task-catalog/records.js';
import { createMemoryTaskCatalogStore } from '../task-catalog/store.js';

import type { ITaskCatalogStore } from '../task-catalog/store.js';
import type { IOffer, ITaskDefinition } from '../task-catalog/types.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function stateDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'task-catalog-'));
  directories.push(path);
  return path;
}

const clock = { now: new Date('2026-11-20T10:00:00Z') };

const offer = (change: Partial<IOffer> = {}): IOffer => ({
  id: 'offer-a1',
  definitionId: 'catch-up-on-mailbox',
  definitionRevision: 1,
  source: 'agent',
  reason: 'Three unread messages from your landlord arrived today.',
  contextRefs: [{ kind: 'mail', id: 'msg-1' }],
  createdAt: '2026-11-20T09:00:00Z',
  expiresAt: '2026-11-27T09:00:00Z',
  decision: 'open',
  dedupeKey: 'catch-up:account-1:thread-9',
  ...change,
});

const owned: ITaskDefinition = {
  ...structuredClone(BUILT_IN_DEFINITIONS[3]!),
  id: 'my-own-check',
  title: 'My own check',
};

const adapters: readonly [string, () => ITaskCatalogStore][] = [
  ['memory', () => createMemoryTaskCatalogStore({ now: () => clock.now })],
  [
    'file',
    () =>
      createFileTaskCatalogStore({
        directory: join(stateDirectory(), 'task-catalog'),
        now: () => clock.now,
      }),
  ],
];

describe.each(adapters)('the %s task-catalog store', (_name, create) => {
  afterEach(() => {
    clock.now = new Date('2026-11-20T10:00:00Z');
  });

  it('starts empty, keeps an offer and gives it back, and says nothing is wrong', async () => {
    const store = create();
    expect(await store.listOffers()).toEqual([]);
    expect(await store.listDefinitions()).toEqual([]);
    expect(await store.getOffer('offer-a1')).toBeUndefined();
    expect(await store.issues()).toEqual([]);
    expect(await store.putOffer(offer())).toEqual(offer());
    expect(await store.listOffers()).toEqual([offer()]);
    expect(await store.getOffer('offer-a1')).toEqual(offer());
  });

  it('reads an open offer as expired once its time has passed, and leaves a recorded decision as it is', async () => {
    const store = create();
    await store.putOffer(offer({ expiresAt: '2026-11-20T11:00:00Z' }));
    await store.putOffer(
      offer({ id: 'offer-b2', dedupeKey: 'other', expiresAt: '2026-11-20T11:00:00Z' }),
    );
    await store.setOfferDecision('offer-b2', 'dismissed');
    const decisions = async () =>
      (await store.listOffers()).map((entry) => [entry.id, entry.decision]);
    expect(await decisions()).toEqual([
      ['offer-a1', 'open'],
      ['offer-b2', 'dismissed'],
    ]);
    clock.now = new Date('2026-11-20T11:00:00Z');
    expect(await decisions()).toEqual([
      ['offer-a1', 'expired'],
      ['offer-b2', 'dismissed'],
    ]);
    expect((await store.getOffer('offer-a1'))?.decision).toBe('expired');
  });

  it.each(['accepted', 'dismissed', 'superseded', 'expired'] as const)(
    'stores a new offer open although it claims %s',
    async (claimed) => {
      const store = create();
      expect((await store.putOffer(offer({ decision: claimed }))).decision).toBe('open');
      expect((await store.getOffer('offer-a1'))?.decision).toBe('open');
      expect((await store.listOffers()).map((entry) => entry.decision)).toEqual(['open']);
    },
  );

  it('updates the evidence of the offer that has a dedupe key instead of adding a copy', async () => {
    const store = create();
    await store.putOffer(offer({ prefilled: { focus: 'rent' } }));
    const again = await store.putOffer(
      offer({
        id: 'offer-c3',
        source: 'owner',
        reason: 'A fourth unread message arrived.',
        contextRefs: [{ kind: 'mail', id: 'msg-2' }],
        createdAt: '2026-11-21T09:00:00Z',
        expiresAt: '2026-11-28T09:00:00Z',
        prefilled: { focus: 'deposit' },
      }),
    );
    // Who the offer is, who made it and when stay as they were; what it rests on is the new evidence.
    expect(again).toEqual(
      offer({
        reason: 'A fourth unread message arrived.',
        contextRefs: [{ kind: 'mail', id: 'msg-2' }],
        expiresAt: '2026-11-28T09:00:00Z',
        prefilled: { focus: 'deposit' },
      }),
    );
    expect(again.source).toBe('agent');
    expect(await store.listOffers()).toEqual([again]);
    expect(await store.getOffer('offer-c3')).toBeUndefined();
    const without = await store.putOffer(offer({ id: 'offer-d4' }));
    expect(without).not.toHaveProperty('prefilled');
  });

  it.each(['dismissed', 'accepted', 'superseded'] as const)(
    'keeps a %s offer as it was when its key comes again, under a new id or under its own',
    async (decided) => {
      const store = create();
      await store.putOffer(offer());
      await store.setOfferDecision('offer-a1', decided);
      for (const id of ['offer-d4', 'offer-a1']) {
        const repeat = await store.putOffer(
          offer({
            id,
            reason: `Seen again as ${id}.`,
            createdAt: '2026-11-22T09:00:00Z',
            expiresAt: '2026-12-31T09:00:00Z',
            decision: 'open',
          }),
        );
        expect(repeat).toEqual(
          expect.objectContaining({
            id: 'offer-a1',
            decision: decided,
            createdAt: '2026-11-20T09:00:00Z',
            reason: `Seen again as ${id}.`,
            expiresAt: '2026-12-31T09:00:00Z',
          }),
        );
      }
      expect((await store.listOffers()).map((entry) => [entry.id, entry.decision])).toEqual([
        ['offer-a1', decided],
      ]);
    },
  );

  it('brings back a lapsed offer only when its key comes again with a later expiry', async () => {
    const store = create();
    await store.putOffer(offer({ expiresAt: '2026-11-20T11:00:00Z' }));
    clock.now = new Date('2026-11-20T12:00:00Z');
    expect((await store.getOffer('offer-a1'))?.decision).toBe('expired');
    // The same expiry, or an earlier one, is no new reason: the offer stays lapsed.
    await store.putOffer(offer({ id: 'offer-e5', expiresAt: '2026-11-20T11:00:00Z' }));
    await store.putOffer(offer({ id: 'offer-e6', expiresAt: '2026-11-20T10:30:00Z' }));
    expect((await store.getOffer('offer-a1'))?.decision).toBe('expired');
    await store.putOffer(offer({ id: 'offer-e7', expiresAt: '2026-11-30T09:00:00Z' }));
    expect((await store.getOffer('offer-a1'))?.decision).toBe('open');
  });

  it('returns an offer recorded as expired to open only with a later expiry', async () => {
    const store = create();
    await store.putOffer(offer());
    await store.setOfferDecision('offer-a1', 'expired');
    await store.putOffer(offer({ id: 'offer-e5', reason: 'Same expiry.' }));
    expect(await store.getOffer('offer-a1')).toEqual(
      expect.objectContaining({ decision: 'expired', reason: 'Same expiry.' }),
    );
    await store.putOffer(offer({ id: 'offer-e6', expiresAt: '2026-12-31T09:00:00Z' }));
    expect((await store.getOffer('offer-a1'))?.decision).toBe('open');
  });

  it('records the person’s decision, and refuses an offer that is not kept and a decision that is not one', async () => {
    const store = create();
    await store.putOffer(offer());
    const accepted = await store.setOfferDecision('offer-a1', 'accepted');
    expect(accepted).toEqual(
      offer({ decision: 'accepted', reactions: { accepted: '2026-11-20T10:00:00.000Z' } }),
    );
    expect((await store.getOffer('offer-a1'))?.decision).toBe('accepted');
    await expect(store.setOfferDecision('offer-zz', 'dismissed')).rejects.toThrow(
      /No offer offer-zz/u,
    );
    for (const decision of ['started', 'OPEN', '', undefined, 3]) {
      await expect(store.setOfferDecision('offer-a1', decision as never)).rejects.toThrow(
        /decision must be one of open, snoozed, dismissed, accepted, expired, superseded/u,
      );
    }
    expect((await store.getOffer('offer-a1'))?.decision).toBe('accepted');
    expect(await store.listOffers()).toHaveLength(1);
  });

  it('refuses a repeat that names another task or would expire before the offer began', async () => {
    const store = create();
    await store.putOffer(offer());
    await expect(
      store.putOffer(offer({ id: 'offer-b2', definitionId: 'prepare-my-week' })),
    ).rejects.toThrow(/cannot change which task an offer is for/u);
    await expect(
      store.putOffer(
        offer({
          id: 'offer-b2',
          createdAt: '2026-11-10T09:00:00Z',
          expiresAt: '2026-11-15T09:00:00Z',
        }),
      ),
    ).rejects.toThrow(/after the offer was first made/u);
    expect(await store.listOffers()).toEqual([offer()]);
  });

  it('refuses a new key under an id another offer already has', async () => {
    const store = create();
    await store.putOffer(offer());
    await store.putOffer(offer({ id: 'offer-b2', dedupeKey: 'other' }));
    await expect(store.putOffer(offer({ id: 'offer-b2', dedupeKey: 'third' }))).rejects.toThrow(
      /Another offer already has this id/u,
    );
    expect(await store.listOffers()).toHaveLength(2);
  });

  it('refuses a record that is not an offer, and keeps nothing of it', async () => {
    const store = create();
    await expect(store.putOffer({ ...offer(), reason: 'x'.repeat(301) })).rejects.toThrow(
      TaskCatalogRefusedError,
    );
    await expect(store.putOffer({ ...offer(), extra: 1 } as IOffer)).rejects.toThrow(
      /unknown field/u,
    );
    expect(await store.listOffers()).toEqual([]);
  });

  it('snoozes an offer until a time, reads it as open again once the time has come, and keeps the time of the snooze', async () => {
    const store = create();
    await store.putOffer(offer());
    const snoozed = await store.setOfferDecision('offer-a1', 'snoozed', {
      snoozedUntil: '2026-11-21T10:00:00Z',
    });
    expect(snoozed).toMatchObject({
      decision: 'snoozed',
      snoozedUntil: '2026-11-21T10:00:00Z',
      reactions: { snoozed: '2026-11-20T10:00:00.000Z' },
    });
    clock.now = new Date('2026-11-21T09:59:59Z');
    expect((await store.getOffer('offer-a1'))?.decision).toBe('snoozed');
    clock.now = new Date('2026-11-21T10:00:00Z');
    const awake = await store.getOffer('offer-a1');
    expect(awake?.decision).toBe('open');
    expect(awake).not.toHaveProperty('snoozedUntil');
    // Reading changed nothing that was kept, so an earlier clock reads the snooze again.
    clock.now = new Date('2026-11-20T11:00:00Z');
    expect((await store.getOffer('offer-a1'))?.decision).toBe('snoozed');
  });

  it('reads a snoozed offer as expired once its own expiry has passed, snooze or not', async () => {
    const store = create();
    await store.putOffer(offer({ expiresAt: '2026-11-22T09:00:00Z' }));
    await store.setOfferDecision('offer-a1', 'snoozed', { snoozedUntil: '2026-11-25T09:00:00Z' });
    clock.now = new Date('2026-11-23T09:00:00Z');
    expect((await store.getOffer('offer-a1'))?.decision).toBe('expired');
  });

  it('takes a snooze only with its time, and a time only with a snooze', async () => {
    const store = create();
    await store.putOffer(offer());
    await expect(store.setOfferDecision('offer-a1', 'snoozed')).rejects.toThrow(/needs the time/u);
    await expect(
      store.setOfferDecision('offer-a1', 'dismissed', { snoozedUntil: '2026-11-21T10:00:00Z' }),
    ).rejects.toThrow(/needs the time it ends, and no other decision does/u);
    await expect(
      store.setOfferDecision('offer-a1', 'snoozed', { snoozedUntil: 'tomorrow' }),
    ).rejects.toThrow(/UTC time/u);
    expect((await store.getOffer('offer-a1'))?.decision).toBe('open');
  });

  it('keeps a snooze and the reactions through a repeat observation of the same source matter', async () => {
    const store = create();
    await store.putOffer(offer());
    await store.setOfferDecision('offer-a1', 'snoozed', { snoozedUntil: '2026-11-22T10:00:00Z' });
    await store.recordReaction(['offer-a1'], { kind: 'shown' });
    const again = await store.putOffer(
      offer({ id: 'offer-z9', reason: 'Seen again.', basis: 'A newer basis.' }),
    );
    expect(again).toMatchObject({
      id: 'offer-a1',
      decision: 'snoozed',
      snoozedUntil: '2026-11-22T10:00:00Z',
      reason: 'Seen again.',
      basis: 'A newer basis.',
      reactions: { shown: '2026-11-20T10:00:00.000Z', snoozed: '2026-11-20T10:00:00.000Z' },
    });
  });

  it('accepts an offer with the launch that made it, once, and keeps the first launch', async () => {
    const store = create();
    await store.putOffer(offer());
    const first = `launch-${'1'.repeat(8)}-0000-4000-8000-000000000000`;
    const accepted = await store.acceptOffer('offer-a1', first);
    expect(accepted).toMatchObject({
      decision: 'accepted',
      launchId: first,
      reactions: { accepted: '2026-11-20T10:00:00.000Z' },
    });
    clock.now = new Date('2026-11-20T11:00:00Z');
    expect(
      await store.acceptOffer('offer-a1', `launch-${'2'.repeat(8)}-0000-4000-8000-000000000000`),
    ).toEqual(accepted);
    await expect(store.acceptOffer('offer-zz', first)).rejects.toThrow(/No offer offer-zz/u);
    expect(await store.getOffer('offer-a1')).toEqual(accepted);
  });

  it('keeps the first time of an acceptance recorded as a decision, and the latest of a dismissal', async () => {
    const store = create();
    await store.putOffer(offer());
    await store.setOfferDecision('offer-a1', 'accepted');
    await store.setOfferDecision('offer-a1', 'dismissed');
    clock.now = new Date('2026-11-20T11:00:00Z');
    await store.setOfferDecision('offer-a1', 'accepted');
    await store.setOfferDecision('offer-a1', 'dismissed');
    expect((await store.getOffer('offer-a1'))?.reactions).toEqual({
      accepted: '2026-11-20T10:00:00.000Z',
      dismissed: '2026-11-20T11:00:00.000Z',
    });
  });

  it('records each reaction once, the first time, and an outcome once, apart from the acceptance', async () => {
    const store = create();
    await store.putOffer(offer());
    await store.putOffer(offer({ id: 'offer-b2', dedupeKey: 'other' }));
    await store.recordReaction(['offer-a1', 'offer-gone'], { kind: 'shown' });
    clock.now = new Date('2026-11-20T10:05:00Z');
    await store.recordReaction(['offer-a1', 'offer-b2'], { kind: 'shown' });
    await store.recordReaction(['offer-a1'], { kind: 'opened' });
    await store.recordReaction(['offer-a1'], { kind: 'started' });
    await store.recordReaction(['offer-a1'], { kind: 'outcome', state: 'unverified' });
    await store.recordReaction(['offer-a1'], { kind: 'outcome', state: 'verified' });
    expect((await store.getOffer('offer-a1'))?.reactions).toEqual({
      shown: '2026-11-20T10:00:00.000Z',
      opened: '2026-11-20T10:05:00.000Z',
      started: '2026-11-20T10:05:00.000Z',
      outcome: { state: 'unverified', at: '2026-11-20T10:05:00.000Z' },
    });
    expect((await store.getOffer('offer-b2'))?.reactions).toEqual({
      shown: '2026-11-20T10:05:00.000Z',
    });
    await store.recordReaction(['offer-b2'], { kind: 'outcome', state: 'verified' });
    expect((await store.getOffer('offer-b2'))?.reactions).toMatchObject({
      verified: '2026-11-20T10:05:00.000Z',
      outcome: { state: 'verified' },
    });
  });

  describe('a repeat observation never moves anything backward', () => {
    const seen = (hours: number, change: Partial<IOffer> = {}): IOffer =>
      offer({
        evidence: {
          kind: 'connector',
          connectorId: 'connector-mail-1',
          sourceItemId: 'mail:msg-1',
          observedAt: `2026-11-20T${String(hours).padStart(2, '0')}:00:00Z`,
        },
        ...change,
      });

    it('leaves an offer as it is for a repeat dated before the observation it rests on, whatever else the repeat says', async () => {
      const store = create();
      const first = await store.putOffer(
        seen(9, { reason: 'First.', basis: 'First basis.', prefilled: { focus: 'rent' } }),
      );
      const older = await store.putOffer(
        seen(8, {
          id: 'offer-z9',
          reason: 'Older.',
          basis: 'Older basis.',
          prefilled: { focus: 'deposit' },
          expiresAt: '2026-12-31T09:00:00Z',
        }),
      );
      expect(older).toEqual(first);
      expect(await store.listOffers()).toEqual([first]);
    });

    it('takes a repeat dated the same time or later, and never an earlier expiry from it', async () => {
      const store = create();
      await store.putOffer(seen(9));
      const same = await store.putOffer(seen(9, { id: 'offer-y8', reason: 'Same time.' }));
      expect(same.reason).toBe('Same time.');
      const later = await store.putOffer(
        seen(10, { id: 'offer-z9', reason: 'Later.', expiresAt: '2026-11-21T09:00:00Z' }),
      );
      expect(later).toMatchObject({
        reason: 'Later.',
        expiresAt: '2026-11-27T09:00:00Z',
        evidence: { observedAt: '2026-11-20T10:00:00Z' },
      });
      const longer = await store.putOffer(
        seen(11, { id: 'offer-x7', expiresAt: '2026-12-03T09:00:00Z' }),
      );
      expect(longer.expiresAt).toBe('2026-12-03T09:00:00Z');
    });

    it('keeps the evidence of an offer when a repeat brings none', async () => {
      const store = create();
      await store.putOffer(seen(9));
      const bare = await store.putOffer(offer({ id: 'offer-z9', reason: 'No evidence.' }));
      expect(bare.reason).toBe('No evidence.');
      expect(bare.evidence?.observedAt).toBe('2026-11-20T09:00:00Z');
    });

    it('lets no repeat make a snoozed offer expire before its snooze ends', async () => {
      const store = create();
      await store.putOffer(seen(9));
      await store.setOfferDecision('offer-a1', 'snoozed', { snoozedUntil: '2026-11-26T09:00:00Z' });
      await store.putOffer(seen(10, { id: 'offer-z9', expiresAt: '2026-11-21T09:00:00Z' }));
      await store.putOffer(seen(8, { id: 'offer-y8', expiresAt: '2026-11-20T11:00:00Z' }));
      clock.now = new Date('2026-11-24T09:00:00Z');
      const still = await store.getOffer('offer-a1');
      expect(still).toMatchObject({ decision: 'snoozed', expiresAt: '2026-11-27T09:00:00Z' });
      clock.now = new Date('2026-11-26T09:00:00Z');
      expect((await store.getOffer('offer-a1'))?.decision).toBe('open');
    });
  });

  it('keeps the time of a dismissal and of the snooze before it, and drops the snooze itself', async () => {
    const store = create();
    await store.putOffer(offer());
    await store.setOfferDecision('offer-a1', 'snoozed', { snoozedUntil: '2026-11-22T10:00:00Z' });
    clock.now = new Date('2026-11-20T12:00:00Z');
    const dismissed = await store.setOfferDecision('offer-a1', 'dismissed');
    expect(dismissed.decision).toBe('dismissed');
    expect(dismissed).not.toHaveProperty('snoozedUntil');
    expect(dismissed.reactions).toEqual({
      snoozed: '2026-11-20T10:00:00.000Z',
      dismissed: '2026-11-20T12:00:00.000Z',
    });
  });

  it('keeps installed definitions by revision, and never lets a published revision change', async () => {
    const store = create();
    await store.putDefinition(owned);
    await store.putDefinition(owned);
    await store.putDefinition({ ...owned, revision: 2, title: 'My own check, again' });
    expect((await store.listDefinitions()).map((entry) => [entry.id, entry.revision])).toEqual([
      ['my-own-check', 1],
      ['my-own-check', 2],
    ]);
    await expect(store.putDefinition({ ...owned, title: 'Changed in place' })).rejects.toThrow(
      /does not change/u,
    );
    await expect(
      store.putDefinition({ ...owned, execution: 'recurring' } as never),
    ).rejects.toThrow(TaskCatalogRefusedError);
    expect(await store.listDefinitions()).toHaveLength(2);
  });
});

describe('making room in a full store', () => {
  const full = (change: (index: number) => Partial<IOffer>): IOffer[] =>
    Array.from({ length: MAX_OFFERS }, (_, i) =>
      offer({
        id: `offer-n${i}`,
        dedupeKey: `key-${i}`,
        createdAt: new Date(Date.parse('2026-01-01T00:00:00Z') + i * 60_000).toISOString(),
        expiresAt: new Date(Date.parse('2026-01-08T00:00:00Z') + i * 60_000).toISOString(),
        ...change(i),
      }),
    );
  const later = (): IOffer =>
    offer({
      id: 'offer-new',
      dedupeKey: 'key-new',
      createdAt: '2026-11-20T09:00:00Z',
      expiresAt: '2026-11-27T09:00:00Z',
    });

  it('drops the oldest finished offer that is old enough, and no other', () => {
    const offers = full((i) =>
      i === 3 || i === 1 ? { decision: 'dismissed' } : { expiresAt: '2027-01-01T00:00:00Z' },
    );
    const next = putOfferInto(offers, later()).offers;
    expect(next).toHaveLength(MAX_OFFERS);
    expect(next.map((entry) => entry.id)).not.toContain('offer-n1');
    expect(next.map((entry) => entry.id)).toContain('offer-n3');
    expect(next.at(-1)!.id).toBe('offer-new');
  });

  it('counts an undecided offer whose time is long gone as finished, and an open one as not', () => {
    const lapsed = full(() => ({}));
    expect(putOfferInto(lapsed, later()).offers.map((entry) => entry.id)).not.toContain('offer-n0');
    const open = full(() => ({ expiresAt: '2027-01-01T00:00:00Z' }));
    expect(() => putOfferInto(open, later())).toThrow(/At most 500 offers/u);
  });

  it('keeps every offer whose decision is still fresh, however many there are', () => {
    const recent = full((i) => ({
      decision: 'dismissed',
      createdAt: new Date(Date.parse('2026-11-01T00:00:00Z') + i * 60_000).toISOString(),
    }));
    expect(() => putOfferInto(recent, later())).toThrow(/At most 500 offers/u);
  });
});

describe('the one-offer-per-key rule', () => {
  it('stops at a bounded number of offers, whichever store applies it', () => {
    const offers = Array.from({ length: MAX_OFFERS }, (_, i) =>
      offer({ id: `offer-n${i}`, dedupeKey: `key-${i}` }),
    );
    expect(() => putOfferInto(offers, offer({ id: 'offer-over', dedupeKey: 'key-over' }))).toThrow(
      /At most 500 offers/u,
    );
    // A repeat of a kept key still goes through when the limit is reached: it adds nothing.
    expect(putOfferInto(offers, offer({ id: 'offer-x', dedupeKey: 'key-3' })).offers).toHaveLength(
      MAX_OFFERS,
    );
    expect(putOfferInto(offers, offer({ id: 'offer-n7', dedupeKey: 'key-7' })).offers).toHaveLength(
      MAX_OFFERS,
    );
    expect(() => putOfferInto(offers, offer({ id: 'offer-n7', dedupeKey: 'key-new' }))).toThrow(
      /already has this id/u,
    );
  });
});

describe('the file task-catalog store', () => {
  const open = (root: string, now = () => clock.now) =>
    createFileTaskCatalogStore({ directory: join(root, 'task-catalog'), now });

  it('keeps what it was given across a restart', async () => {
    const root = stateDirectory();
    const first = open(root);
    await first.putOffer(offer());
    await first.putOffer(offer({ id: 'offer-b2', dedupeKey: 'other' }));
    await first.setOfferDecision('offer-b2', 'accepted');
    await first.putDefinition(owned);
    const second = open(root);
    expect((await second.listOffers()).map((entry) => [entry.id, entry.decision])).toEqual([
      ['offer-a1', 'open'],
      ['offer-b2', 'accepted'],
    ]);
    expect(await second.listDefinitions()).toEqual([owned]);
    // A repeat observation after the restart still finds the offer by its key, and the decision stays.
    await second.putOffer(offer({ id: 'offer-z9', dedupeKey: 'other', reason: 'Seen again.' }));
    expect(
      (await open(root).listOffers()).map((entry) => [entry.id, entry.decision, entry.reason]),
    ).toEqual([
      ['offer-a1', 'open', offer().reason],
      ['offer-b2', 'accepted', 'Seen again.'],
    ]);
  });

  it.skipIf(process.platform === 'win32')(
    'is owner-only: the directory 0700 and each file 0600',
    async () => {
      const root = stateDirectory();
      const store = open(root);
      await store.putOffer(offer());
      await store.putDefinition(owned);
      const directory = join(root, 'task-catalog');
      expect(statSync(directory).mode & 0o777).toBe(0o700);
      expect(readdirSync(directory).sort()).toEqual(['definitions.json', 'offers.json']);
      for (const name of ['offers.json', 'definitions.json'])
        expect(statSync(join(directory, name)).mode & 0o777, name).toBe(0o600);
    },
  );

  it('starts empty and reports an issue, without a path, when a file is damaged', async () => {
    const root = stateDirectory();
    const directory = join(root, 'task-catalog');
    const store = open(root);
    await store.putOffer(offer());
    writeFileSync(join(directory, 'offers.json'), '{"offers": [ not json');
    writeFileSync(join(directory, 'definitions.json'), '[1, 2]');
    expect(await store.listOffers()).toEqual([]);
    expect(await store.listDefinitions()).toEqual([]);
    const issues = await store.issues();
    expect(issues).toEqual([
      'Saved offers could not be read, so none are shown.',
      'Saved task definitions could not be read, so none are shown.',
    ]);
    for (const issue of issues) {
      expect(issue).not.toContain(root);
      expect(issue).not.toContain('task-catalog');
    }
  });

  it('shows the offers it can read and counts the ones it cannot', async () => {
    const root = stateDirectory();
    const directory = join(root, 'task-catalog');
    const store = open(root);
    await store.putOffer(offer());
    const saved = JSON.parse(readFileSync(join(directory, 'offers.json'), 'utf8')) as {
      offers: unknown[];
    };
    writeFileSync(
      join(directory, 'offers.json'),
      JSON.stringify({ offers: [...saved.offers, { id: 'offer-bad', reason: 'no other fields' }] }),
    );
    expect((await store.listOffers()).map((entry) => entry.id)).toEqual(['offer-a1']);
    expect(await store.issues()).toEqual(['1 saved offer could not be read and is not shown.']);
    writeFileSync(
      join(directory, 'offers.json'),
      JSON.stringify({ offers: [...saved.offers, { id: 'offer-bad' }, { definitionId: 'x' }] }),
    );
    expect(await store.issues()).toEqual(['2 saved offers could not be read and are not shown.']);
  });

  it('sets a damaged file aside before it writes a new one, so nothing is lost silently', async () => {
    const root = stateDirectory();
    const directory = join(root, 'task-catalog');
    const store = open(root);
    writeFileSync(join(directory, 'offers.json'), '{"offers": [ not json');
    await store.putOffer(offer());
    expect(readFileSync(join(directory, 'offers.json.damaged'), 'utf8')).toBe(
      '{"offers": [ not json',
    );
    expect((await store.listOffers()).map((entry) => entry.id)).toEqual(['offer-a1']);
    expect(await store.issues()).toEqual([]);
    expect(existsSync(join(directory, 'definitions.json'))).toBe(false);
  });
});
