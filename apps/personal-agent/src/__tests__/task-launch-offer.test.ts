/**
 * A start that names an offer, at the coordinator: the offer is judged again before anything is kept, a
 * refusal leaves no intent and no goal, the offer is told once the launch made a goal and again how it
 * ended, and a stop between a launch moving and the offer being told is made up at the next start of
 * the host. The offers are a stand-in port here; the service behind it has its own tests.
 */
import { describe, expect, it, vi } from 'vitest';

import { parseIntent } from '../task-catalog/launch/validate.js';
import { createMemoryLaunchStore } from '../task-catalog/launch/store.js';
import {
  launchIntent,
  receipt,
  request,
  runLaunchedGoal,
  runOf,
  startWorld,
} from './launch-world.js';

import type { ILaunchOffers, TOfferAdmission } from '../task-catalog/launch/coordinator.js';

const OFFER = 'offer-a1';

function offersPort(admission: TOfferAdmission = { ok: true }) {
  const calls: string[] = [];
  const port: ILaunchOffers = {
    admit: vi.fn(async (id) => {
      calls.push(`admit ${id}`);
      return admission;
    }),
    accepted: vi.fn(async (id, launchId) => {
      calls.push(`accepted ${id} ${launchId}`);
    }),
    started: vi.fn(async (id) => {
      calls.push(`started ${id}`);
    }),
    outcome: vi.fn(async (id, state) => {
      calls.push(`outcome ${id} ${state}`);
    }),
  };
  return { port, calls };
}

const fromOffer = (change: { key?: string; offerId?: unknown } = {}) => ({
  ...request(change.key === undefined ? {} : { key: change.key }),
  offerId: 'offerId' in change ? change.offerId : OFFER,
});

describe('a start that names an offer', () => {
  it('is judged by the offer’s gate before anything is kept, and then keeps the offer as its origin', async () => {
    const { port } = offersPort();
    const world = startWorld({ offers: port });
    const started = await world.launches.start(fromOffer());
    expect(started.created).toBe(true);
    expect(started.launch.origin).toEqual({ kind: 'offer', offerId: OFFER });
    expect(port.admit).toHaveBeenCalledTimes(1);
    expect(port.admit).toHaveBeenCalledWith(
      OFFER,
      expect.objectContaining({ id: 'check-fact-on-page' }),
    );
    expect((await world.store.list())[0]!.origin).toEqual({ kind: 'offer', offerId: OFFER });
  });

  it.each([
    ['unknown', 'There is no such offer.'],
    ['conflict', 'You dismissed this offer. Bring it back to start it.'],
    ['invalid', 'This offer is for another task.'],
  ] as const)(
    'refuses an offer the gate refuses as %s, with nothing kept and no goal made',
    async (kind, reason) => {
      const { port, calls } = offersPort({ ok: false, kind, reason });
      const world = startWorld({ offers: port });
      const refused = await world.launches.start(fromOffer()).catch((error: unknown) => error);
      expect(refused).toMatchObject({ kind, message: reason });
      expect(await world.store.list()).toEqual([]);
      expect(await world.goals.list()).toEqual([]);
      expect(world.create).not.toHaveBeenCalled();
      expect(calls).toEqual([`admit ${OFFER}`]);
    },
  );

  it('is refused as not ready before its offer is looked at when the task cannot run', async () => {
    const { port } = offersPort();
    const world = startWorld({ offers: port, browser: { current: 'unavailable' } });
    await expect(world.launches.start(fromOffer())).rejects.toMatchObject({ kind: 'not-ready' });
    expect(port.admit).not.toHaveBeenCalled();
  });

  it('is refused when the host has no offers at all, and when the id is not an offer id', async () => {
    const world = startWorld();
    await expect(world.launches.start(fromOffer())).rejects.toMatchObject({
      kind: 'unknown',
      message: 'There is no such offer.',
    });
    const { port } = offersPort();
    const other = startWorld({ offers: port });
    for (const bad of ['x', 7, null, '', 'offer-']) {
      await expect(other.launches.start(fromOffer({ offerId: bad }))).rejects.toMatchObject({
        kind: 'invalid',
        message: 'offerId is not the id of an offer',
      });
    }
    expect(port.admit).not.toHaveBeenCalled();
    expect(await world.store.list()).toEqual([]);
  });

  it('answers a retry of the same key from the launch it made, without asking the offer again', async () => {
    const { port } = offersPort();
    const world = startWorld({ offers: port });
    const first = await world.launches.start(fromOffer());
    // The offer was dismissed since: the request that was admitted is still its own answer.
    (port.admit as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      kind: 'conflict',
      reason: 'This offer was already started.',
    });
    const again = await world.launches.start(fromOffer());
    expect(again).toMatchObject({ created: false, goalId: first.goalId });
    expect(port.admit).toHaveBeenCalledTimes(1);
    expect(world.create).toHaveBeenCalledTimes(1);
  });

  it('makes one goal for a double click at once, and tells the offer once', async () => {
    const { port } = offersPort();
    const world = startWorld({ offers: port });
    const answers = await Promise.all(
      Array.from({ length: 8 }, () => world.launches.start(fromOffer())),
    );
    expect(new Set(answers.map((answer) => answer.goalId)).size).toBe(1);
    expect(world.create).toHaveBeenCalledTimes(1);
    expect(port.accepted).toHaveBeenCalledTimes(1);
    expect(port.accepted).toHaveBeenCalledWith(OFFER, answers[0]!.launch.id);
  });

  it('treats the same key for the same task and values with another offer, or none, as another request', async () => {
    const { port } = offersPort();
    const world = startWorld({ offers: port });
    await world.launches.start(fromOffer());
    for (const change of [{ offerId: 'offer-b2' }, { offerId: undefined }]) {
      const reused = await world.launches
        .start({ ...request(), ...change })
        .catch((error: unknown) => error);
      expect(reused).toMatchObject({ kind: 'conflict' });
    }
    expect(world.create).toHaveBeenCalledTimes(1);
  });

  it('keeps a manual start as it was: no offer is asked or told', async () => {
    const { port, calls } = offersPort();
    const world = startWorld({ offers: port });
    const started = await world.launches.start(request());
    expect(started.launch.origin).toEqual({ kind: 'manual' });
    expect(calls).toEqual([]);
  });
});

describe('what the offer is told', () => {
  it('hears that its task started when its run begins, and how it ended apart from that', async () => {
    const { port, calls } = offersPort();
    const world = startWorld({ offers: port });
    const started = await world.launches.start(fromOffer());
    const goal = (await world.goals.get(started.goalId))!;
    const launchId = started.launch.id;
    expect(calls).toEqual([`admit ${OFFER}`, `accepted ${OFFER} ${launchId}`]);

    await world.launches.shape(goal, runOf(goal));
    expect(calls.at(-1)).toBe(`started ${OFFER}`);

    await runLaunchedGoal(world, goal.id, { outcome: 'done', report: 'Yes.' });
    expect((await world.launches.get(launchId))?.progress).toBe('unverified');
    expect(calls.at(-1)).toBe(`outcome ${OFFER} unverified`);
    // Asked again, the outcome is not told again by the read: it was decided once.
    await world.launches.get(launchId);
    expect(calls.filter((call) => call.startsWith('outcome'))).toHaveLength(1);
  });

  it('is told a verified outcome as verified', async () => {
    const { port, calls } = offersPort();
    const world = startWorld({ offers: port });
    const started = await world.launches.start(fromOffer());
    await runLaunchedGoal(world, started.goalId, {
      outcome: 'done',
      report: 'Yes.',
      reads: [receipt()],
    });
    await world.launches.get(started.launch.id);
    expect(calls.at(-1)).toBe(`outcome ${OFFER} verified`);
  });

  it('never fails a start because the offer could not be told, and tells it at the next start of the host', async () => {
    const { port, calls } = offersPort();
    (port.accepted as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));
    (port.outcome as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));
    const world = startWorld({ offers: port });
    const started = await world.launches.start(fromOffer());
    expect(started.created).toBe(true);
    expect(port.accepted).toHaveBeenCalledTimes(1);

    await runLaunchedGoal(world, started.goalId, { outcome: 'done', report: 'Yes.' });
    await world.launches.get(started.launch.id);
    expect(port.outcome).toHaveBeenCalledTimes(1);
    // A stop before the offer was told leaves it for the host's next start, where each record is repeated
    // until it holds: a record that is made twice changes nothing.
    await world.launches.recover();
    expect(calls).toContain(`accepted ${OFFER} ${started.launch.id}`);
    expect(calls.at(-1)).toBe(`outcome ${OFFER} unverified`);
    expect(port.outcome).toHaveBeenCalledTimes(2);
  });

  it('tells nothing about a launch that failed before it made a goal', async () => {
    const { port, calls } = offersPort();
    const world = startWorld({ offers: port, dying: { goal: 'before' } });
    await expect(world.launches.start(fromOffer())).rejects.toMatchObject({ kind: 'failed' });
    expect(calls).toEqual([`admit ${OFFER}`]);
  });
});

describe('the kept origin', () => {
  it('reads back an offer origin, and refuses an origin that names more or less than it should', () => {
    const base = launchIntent(1);
    expect(parseIntent({ ...base, origin: { kind: 'offer', offerId: OFFER } }).origin).toEqual({
      kind: 'offer',
      offerId: OFFER,
    });
    for (const origin of [
      { kind: 'offer' },
      { kind: 'offer', offerId: 'x' },
      { kind: 'offer', offerId: OFFER, extra: 1 },
      { kind: 'manual', offerId: OFFER },
      { kind: 'other' },
      'offer',
    ])
      expect(() => parseIntent({ ...base, origin }), JSON.stringify(origin)).toThrow();
  });

  it('is kept by the store as the intent it is', async () => {
    const store = createMemoryLaunchStore();
    await store.reserve(launchIntent(1, { origin: { kind: 'offer', offerId: OFFER } }));
    expect((await store.list())[0]!.origin).toEqual({ kind: 'offer', offerId: OFFER });
  });
});
