/**
 * A start that needs setting up, at the coordinator: the request is kept and waits with no goal, is
 * the same request however it is asked again, moves only when it is read, retried or recovered, and
 * starts by itself only on access the person saw named or chose. Anything newer waits for a look and
 * is confirmed by the digest of what it showed. The connectors are test-only bindings and a test
 * recipe for a mail task; the product's own binding table stays empty.
 */
import { createMemoryGoalStore } from '@robota-sdk/agent-product/personal';
import { describe, expect, it } from 'vitest';

import { issueBinding } from '../task-catalog/bindings.js';
import { BUILT_IN_DEFINITIONS } from '../task-catalog/built-in.js';
import { digestOf } from '../task-catalog/launch/digest.js';
import { launchIntent, startWorld } from './launch-world.js';

import type { ICapabilityBinding } from '../task-catalog/bindings.js';
import type { ILaunchOffers, TOfferAdmission } from '../task-catalog/launch/coordinator.js';
import type { ILaunchRecipe } from '../task-catalog/launch/recipes.js';
import type { IWorld } from './launch-world.js';
import type { IReadinessContext } from '../task-catalog/readiness.js';
import type { ITaskDefinition } from '../task-catalog/types.js';
import type { ILaunchBinding, ILaunchIntent } from '../task-catalog/launch/types.js';

const MAIL = 'catch-up-on-mailbox';
const WORK = 'connector-work';
const HOME = 'connector-home';
const BOUNDARY = 'search words in the connected mailbox; nothing is sent';

const recipe: ILaunchRecipe = {
  definitionId: MAIL,
  revision: 1,
  title: 'Catch up on a connected mailbox',
  pages: [],
  instructions: (inputs) =>
    ['Summarise the recent mail.', JSON.stringify({ period: inputs['period'] })].join('\n\n'),
};
const capabilityTools = { 'mail.search': [] };

/** What each connector is, as the host would hand it to readiness. */
type TAccount = 'usable' | 'revoked';
interface IMail {
  accounts: Record<string, { title: string; state: TAccount }>;
  /** When no connector exists at all, the step is to connect one. */
  boundary: string;
  /** The host cannot run the task at all. */
  gone: boolean;
}

const bindingOf = (account: string, boundary = BOUNDARY): ILaunchBinding => ({
  capability: 'mail.search',
  adapter: 'connector',
  account,
  tool: 'search_mail',
  effect: 'read-only',
  argumentBoundary: boundary,
});

function context(mail: IMail): IReadinessContext {
  if (mail.gone) return { bindings: [], blockers: [], accounts: [] };
  const entries = Object.entries(mail.accounts);
  const accounts = entries.map(([id, entry]) => ({ id, title: entry.title }));
  if (entries.length === 0)
    return {
      bindings: [],
      blockers: [
        {
          capability: 'mail.search',
          effect: 'read-only',
          outcome: 'needs-setup',
          step: { type: 'connect', kind: 'mail' },
        },
      ],
      accounts,
    };
  return {
    bindings: entries
      .filter(([, entry]) => entry.state === 'usable')
      .map(([id]) => issueBinding({ ...bindingOf(id, mail.boundary) } as ICapabilityBinding)),
    blockers: entries
      .filter(([, entry]) => entry.state === 'revoked')
      .map(([id, entry]) => ({
        capability: 'mail.search',
        effect: 'read-only' as const,
        outcome: 'needs-setup' as const,
        step: { type: 'reconnect' as const, connectorId: id, connectorTitle: entry.title },
      })),
    accounts,
  };
}

interface ISetup {
  readonly world: IWorld;
  readonly mail: IMail;
  readonly definitions: ITaskDefinition[];
}

function setup(
  accounts: IMail['accounts'],
  extra: Partial<Parameters<typeof startWorld>[0]> = {},
): ISetup {
  const mail: IMail = { accounts, boundary: BOUNDARY, gone: false };
  const definitions = [structuredClone(BUILT_IN_DEFINITIONS[0]!) as ITaskDefinition];
  const world = startWorld({
    builtIn: definitions,
    recipes: [recipe],
    capabilityTools,
    readiness: async () => context(mail),
    ...extra,
  });
  return { world, mail, definitions };
}

const ask = (key = 1) => ({
  definitionId: MAIL,
  idempotencyKey: `key-${String(key).padStart(8, '0')}`,
  inputs: { period: 'Last day' },
});

const hours = (world: IWorld, count: number): void => {
  world.clock.now = new Date(world.clock.now.getTime() + count * 3_600_000);
};

const only = async (world: IWorld): Promise<ILaunchIntent> => {
  const kept = await world.store.list();
  expect(kept).toHaveLength(1);
  return kept[0]!;
};

describe('a start that needs setup', () => {
  it('is kept as one waiting request with no goal, naming what the person was shown', async () => {
    const { world } = setup({ [WORK]: { title: 'Work mail', state: 'revoked' } });
    const started = await world.launches.start(ask());
    expect(started.goalId).toBeUndefined();
    expect(started.launch).toMatchObject({
      status: 'setup',
      progress: 'setup',
      namedAccounts: [WORK],
      bindings: [],
      steps: [{ type: 'reconnect', connectorId: WORK, connectorTitle: 'Work mail' }],
    });
    const kept = await only(world);
    expect(kept).toMatchObject({ status: 'setup', namedAccounts: [WORK] });
    expect(kept).not.toHaveProperty('goalId');
    expect(await world.goals.list()).toEqual([]);
    expect(world.create).not.toHaveBeenCalled();
  });

  it('is still refused when the host cannot run the task at all', async () => {
    const { world, mail } = setup({});
    mail.gone = true;
    await expect(world.launches.start(ask())).rejects.toMatchObject({ kind: 'not-ready' });
    expect(await world.store.list()).toEqual([]);
  });

  it('is the same request on a double click, a retry and a second tab', async () => {
    const { world } = setup({ [WORK]: { title: 'Work mail', state: 'revoked' } });
    const first = await world.launches.start(ask(1));
    const retry = await world.launches.start(ask(1));
    const tab = await world.launches.start(ask(2));
    const burst = await Promise.all([3, 4, 5, 6].map((key) => world.launches.start(ask(key))));
    expect(first.created).toBe(true);
    for (const again of [retry, tab, ...burst]) {
      expect(again.created).toBe(false);
      expect(again.launch.id).toBe(first.launch.id);
    }
    expect(await world.store.list()).toHaveLength(1);
    expect(await world.goals.list()).toEqual([]);
  });

  it('makes one goal once the sign-in it named is done, however often it is read', async () => {
    const { world, mail } = setup({ [WORK]: { title: 'Work mail', state: 'revoked' } });
    const { launch } = await world.launches.start(ask());
    // Still waiting while the sign-in is not done.
    expect(await world.launches.get(launch.id)).toMatchObject({ progress: 'setup' });
    expect(await world.goals.list()).toEqual([]);
    mail.accounts[WORK]!.state = 'usable';
    const reads = await Promise.all([
      world.launches.get(launch.id),
      world.launches.get(launch.id),
      world.launches.list(10),
    ]);
    expect(reads[0]).toMatchObject({ status: 'launched' });
    expect(await world.launches.get(launch.id)).toMatchObject({ status: 'launched' });
    expect(await world.goals.list()).toHaveLength(1);
    const kept = await only(world);
    expect(kept).toMatchObject({
      status: 'launched',
      goalId: (await world.goals.list())[0]!.id,
      bindings: [bindingOf(WORK)],
      reservedAt: world.clock.now.toISOString(),
    });
    // The same request asked again is its goal.
    const again = await world.launches.start(ask(9));
    expect(again).toMatchObject({ created: false, goalId: kept.goalId });
    expect(await world.goals.list()).toHaveLength(1);
  });

  it('resumes after a restart with one goal, however often it is read or recovered', async () => {
    const goalStore = createMemoryGoalStore();
    const first = setup({ [WORK]: { title: 'Work mail', state: 'revoked' } }, { goalStore });
    const { launch } = await first.world.launches.start(ask());
    // A new process over the same records, after the sign-in was done while no agent ran.
    const second = setup(
      { [WORK]: { title: 'Work mail', state: 'usable' } },
      { goalStore, launchStore: first.world.store },
    );
    await second.world.launches.recover();
    await second.world.launches.recover();
    expect(await second.world.launches.get(launch.id)).toMatchObject({ status: 'launched' });
    expect(await second.world.launches.get(launch.id)).toMatchObject({ status: 'launched' });
    expect(await second.world.goals.list()).toHaveLength(1);
    expect(second.world.create).toHaveBeenCalledTimes(1);
  });

  it('goes to review, not a goal, when the account that became ready was not one the request named', async () => {
    const { world, mail } = setup({});
    const { launch } = await world.launches.start(ask());
    expect(launch).toMatchObject({ status: 'setup', steps: [{ type: 'connect', kind: 'mail' }] });
    expect(launch).not.toHaveProperty('namedAccounts');
    mail.accounts[WORK] = { title: 'Work mail', state: 'usable' };
    const looked = await world.launches.get(launch.id);
    expect(looked).toMatchObject({
      status: 'review',
      progress: 'review',
      proposed: [bindingOf(WORK)],
      reviewDigest: digestOf([bindingOf(WORK)]),
    });
    expect(await world.goals.list()).toEqual([]);
    // Reading it again changes nothing, and it never starts without the person.
    expect(await world.launches.get(launch.id)).toEqual(looked);
    const confirmed = await world.launches.confirm(launch.id, looked!.reviewDigest);
    expect(confirmed).toMatchObject({ status: 'launched', bindings: [bindingOf(WORK)] });
    expect(await world.goals.list()).toHaveLength(1);
    // A second confirmation is refused and makes nothing more.
    await expect(world.launches.confirm(launch.id, looked!.reviewDigest)).rejects.toMatchObject({
      kind: 'conflict',
    });
    expect(await world.goals.list()).toHaveLength(1);
  });

  it('takes an account choice by connector id, and refuses one the task does not offer', async () => {
    const { world } = setup({
      [WORK]: { title: 'Work mail', state: 'usable' },
      [HOME]: { title: 'Home mail', state: 'usable' },
    });
    const { launch } = await world.launches.start(ask());
    expect(launch).toMatchObject({
      status: 'setup',
      namedAccounts: [HOME, WORK],
      steps: [
        {
          type: 'choose-account',
          accounts: [
            { id: HOME, title: 'Home mail' },
            { id: WORK, title: 'Work mail' },
          ],
        },
      ],
    });
    await expect(world.launches.chooseAccount(launch.id, 'connector-ghost')).rejects.toMatchObject({
      kind: 'not-ready',
    });
    await expect(world.launches.chooseAccount(launch.id, 'Home mail')).rejects.toMatchObject({
      kind: 'invalid',
    });
    await expect(world.launches.chooseAccount('launch-none', HOME)).rejects.toMatchObject({
      kind: 'unknown',
    });
    expect(await world.goals.list()).toEqual([]);
    const chosen = await world.launches.chooseAccount(launch.id, HOME);
    expect(chosen).toMatchObject({
      status: 'launched',
      chosenAccounts: [HOME],
      bindings: [bindingOf(HOME)],
    });
    expect(await world.goals.list()).toHaveLength(1);
    // Nothing waits for a choice any more.
    await expect(world.launches.chooseAccount(launch.id, WORK)).rejects.toMatchObject({
      kind: 'conflict',
    });
  });

  it('starts on the chosen account when two accounts share a title', async () => {
    const { world } = setup({
      'connector-mail-1': { title: 'Mail', state: 'usable' },
      'connector-mail-2': { title: 'Mail', state: 'usable' },
    });
    const { launch } = await world.launches.start(ask());
    const chosen = await world.launches.chooseAccount(launch.id, 'connector-mail-2');
    expect(chosen).toMatchObject({
      status: 'launched',
      chosenAccounts: ['connector-mail-2'],
      bindings: [bindingOf('connector-mail-2')],
    });
  });

  it('asks for a look when access was taken away and given back, even if it looks the same', async () => {
    const { world, mail } = setup({
      [WORK]: { title: 'Work mail', state: 'usable' },
      [HOME]: { title: 'Home mail', state: 'usable' },
    });
    const { launch } = await world.launches.start(ask());
    // The work account is revoked: only the home account is left, and it was named, but what was
    // recorded at Start is gone, so the person looks before anything starts.
    mail.accounts[WORK]!.state = 'revoked';
    const revoked = await world.launches.get(launch.id);
    expect(revoked).toMatchObject({
      status: 'review',
      authorityChanged: true,
      proposed: [bindingOf(HOME)],
    });
    // Given back, it is a choice again, and the flag stays.
    mail.accounts[WORK]!.state = 'usable';
    expect(await world.launches.get(launch.id)).toMatchObject({
      status: 'setup',
      authorityChanged: true,
    });
    const chosen = await world.launches.chooseAccount(launch.id, WORK);
    expect(chosen).toMatchObject({
      status: 'review',
      authorityChanged: true,
      proposed: [bindingOf(WORK)],
    });
    expect(await world.goals.list()).toEqual([]);
    const done = await world.launches.confirm(launch.id, chosen.reviewDigest!);
    expect(done.status).toBe('launched');
    expect(await world.goals.list()).toHaveLength(1);
  });

  it('goes back to waiting when what it needed is revoked while it is in review', async () => {
    const { world, mail } = setup({});
    const { launch } = await world.launches.start(ask());
    mail.accounts[WORK] = { title: 'Work mail', state: 'usable' };
    const review = await world.launches.get(launch.id);
    expect(review).toMatchObject({ status: 'review' });
    mail.accounts[WORK]!.state = 'revoked';
    expect(await world.launches.get(launch.id)).toMatchObject({
      status: 'setup',
      progress: 'setup',
      steps: [{ type: 'reconnect', connectorId: WORK, connectorTitle: 'Work mail' }],
    });
    expect(await only(world)).not.toHaveProperty('proposed');
    // Confirming what was shown is refused while it waits for setup.
    await expect(world.launches.confirm(launch.id, review!.reviewDigest!)).rejects.toMatchObject({
      kind: 'conflict',
    });
    expect(await world.goals.list()).toEqual([]);
  });

  it('refuses a confirmation of access that is not what the task would use now, and shows it again', async () => {
    const { world, mail } = setup({});
    const { launch } = await world.launches.start(ask());
    mail.accounts[WORK] = { title: 'Work mail', state: 'usable' };
    const review = await world.launches.get(launch.id);
    expect(review!.reviewDigest).toBe(digestOf([bindingOf(WORK)]));
    // The reviewed tool's boundary is reworded after the person looked.
    mail.boundary = 'search words in the connected mailbox; nothing is sent or kept';
    const refused = await world.launches
      .confirm(launch.id, review!.reviewDigest!)
      .catch((error: unknown) => error);
    expect(refused).toMatchObject({
      kind: 'conflict',
      detail: {
        launch: {
          status: 'review',
          reviewDigest: digestOf([bindingOf(WORK, mail.boundary)]),
        },
      },
    });
    expect(await world.goals.list()).toEqual([]);
    await expect(world.launches.confirm(launch.id, 'not-a-digest')).rejects.toMatchObject({
      kind: 'invalid',
    });
    // What the person confirms is what is shown, so it then starts on exactly that.
    const shown = await world.launches.get(launch.id);
    const done = await world.launches.confirm(launch.id, shown!.reviewDigest!);
    expect(done).toMatchObject({ status: 'launched', bindings: [bindingOf(WORK, mail.boundary)] });
  });

  it('ends, never to start later, when the task changed, left, can no longer run, or waited too long', async () => {
    const cases: readonly [string, (state: ISetup) => void, string][] = [
      [
        'the task changed',
        ({ definitions }) => {
          definitions[0] = { ...definitions[0]!, revision: 2 };
        },
        'This task changed after you asked for it. Look at it again and start it again.',
      ],
      [
        'the task left the catalog',
        ({ definitions }) => {
          definitions.length = 0;
        },
        'This task is no longer in your catalog.',
      ],
      [
        'the task can no longer run here',
        ({ mail }) => {
          mail.gone = true;
        },
        'This task can no longer run here.',
      ],
      [
        'it waited too long',
        ({ world }) => hours(world, 25),
        'This request waited too long for setup. Start it again if you still want it.',
      ],
    ];
    for (const [name, change, message] of cases) {
      const state = setup({ [WORK]: { title: 'Work mail', state: 'revoked' } });
      const { world, mail } = state;
      const { launch } = await world.launches.start(ask());
      change(state);
      mail.accounts[WORK]!.state = 'usable';
      expect(await world.launches.get(launch.id), name).toMatchObject({
        status: 'failed',
        progress: 'failed',
        reason: message,
        failure: { kind: 'stale', message },
      });
      expect(await world.goals.list(), name).toEqual([]);
      // Asking again with the same key is refused with the same reason, and nothing starts.
      await expect(world.launches.start(ask()), name).rejects.toMatchObject({
        kind: 'stale',
        message,
      });
      expect(world.create, name).not.toHaveBeenCalled();
    }
  });

  it('ends a waiting request whose offer no longer passes the gate, with the gate’s reason', async () => {
    let admission: TOfferAdmission = { ok: true };
    const offers: ILaunchOffers = {
      admit: async () => admission,
      accepted: async () => undefined,
      started: async () => undefined,
      outcome: async () => undefined,
    };
    const { world, mail } = setup({ [WORK]: { title: 'Work mail', state: 'revoked' } }, { offers });
    const { launch } = await world.launches.start({ ...ask(), offerId: 'offer-a1' });
    expect(launch).toMatchObject({
      status: 'setup',
      origin: { kind: 'offer', offerId: 'offer-a1' },
    });
    admission = {
      ok: false,
      kind: 'conflict',
      reason: 'You dismissed this offer. Bring it back to start it.',
    };
    mail.accounts[WORK]!.state = 'usable';
    expect(await world.launches.get(launch.id)).toMatchObject({
      status: 'failed',
      failure: { kind: 'stale', message: 'You dismissed this offer. Bring it back to start it.' },
    });
    expect(await world.goals.list()).toEqual([]);
  });

  it('counts the window for a reserved request from its reservation, not from the first Start', async () => {
    const { world } = setup({ [WORK]: { title: 'Work mail', state: 'usable' } });
    const waiting = (n: number): ILaunchIntent =>
      launchIntent(n, {
        definitionId: MAIL,
        definitionDigest: digestOf(BUILT_IN_DEFINITIONS[0]),
        inputs: { period: 'Last day' },
        bindings: [bindingOf(WORK)],
        status: 'setup',
      });
    // Both began two hours ago; one was reserved just now and one a quarter of an hour ago.
    const began = new Date(world.clock.now.getTime() - 2 * 3_600_000).toISOString();
    const recent = world.clock.now.toISOString();
    const old = new Date(world.clock.now.getTime() - 16 * 60_000).toISOString();
    const fresh = { ...waiting(1), createdAt: began, updatedAt: began };
    const stale = { ...waiting(2), createdAt: began, updatedAt: began };
    await world.store.reserve(fresh);
    await world.store.reserve(stale);
    await world.store.advance(fresh.id, {
      status: 'reserved',
      bindings: [bindingOf(WORK)],
      reservedAt: recent,
    });
    await world.store.advance(stale.id, {
      status: 'reserved',
      bindings: [bindingOf(WORK)],
      reservedAt: old,
    });
    await world.launches.recover();
    expect((await world.store.get(fresh.id))!.status).toBe('launched');
    expect(await world.store.get(stale.id)).toMatchObject({
      status: 'failed',
      failure: {
        kind: 'stale',
        message: 'This request waited too long to start. Start it again if you still want it.',
      },
    });
    expect(await world.goals.list()).toHaveLength(1);
  });

  it('is cancelled from setup or review, and a cancelled request never starts', async () => {
    const { world, mail } = setup({});
    const first = await world.launches.start(ask(1));
    expect(await world.launches.cancel(first.launch.id)).toMatchObject({
      status: 'cancelled',
      progress: 'cancelled',
    });
    // A double click on Cancel is the same answer.
    expect(await world.launches.cancel(first.launch.id)).toMatchObject({ status: 'cancelled' });
    await expect(world.launches.start(ask(1))).rejects.toMatchObject({
      kind: 'failed',
      message: 'This request was cancelled before it started.',
    });
    // Another request for the same work is a new one, which can be looked at and cancelled too.
    const second = await world.launches.start(ask(2));
    expect(second.launch.id).not.toBe(first.launch.id);
    mail.accounts[WORK] = { title: 'Work mail', state: 'usable' };
    expect(await world.launches.get(second.launch.id)).toMatchObject({ status: 'review' });
    expect(await world.launches.cancel(second.launch.id)).toMatchObject({ status: 'cancelled' });
    expect(await world.launches.get(second.launch.id)).toMatchObject({ status: 'cancelled' });
    expect(await world.goals.list()).toEqual([]);
    // Neither a request that made a goal nor one that does not exist can be cancelled.
    await expect(world.launches.cancel('launch-none')).rejects.toMatchObject({ kind: 'unknown' });
    const third = await world.launches.start(ask(3));
    expect(third.goalId).toBeDefined();
    await expect(world.launches.cancel(third.launch.id)).rejects.toMatchObject({
      kind: 'conflict',
    });
  });
});
