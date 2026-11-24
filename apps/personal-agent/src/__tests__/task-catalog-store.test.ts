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
    expect(accepted).toEqual(offer({ decision: 'accepted' }));
    expect((await store.getOffer('offer-a1'))?.decision).toBe('accepted');
    await expect(store.setOfferDecision('offer-zz', 'dismissed')).rejects.toThrow(
      /No offer offer-zz/u,
    );
    for (const decision of ['started', 'OPEN', '', undefined, 3]) {
      await expect(store.setOfferDecision('offer-a1', decision as never)).rejects.toThrow(
        /decision must be one of open, dismissed, accepted, expired, superseded/u,
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
