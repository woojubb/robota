/**
 * A start that a stopped host left half way, with the goal book and the launch store as real files. The
 * process "dies" at a step when nothing after it is kept, so the state on disk is exactly what a crash
 * leaves; a new coordinator over the same directories is the restart.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileGoalStore } from '@robota-sdk/agent-product/personal';
import { afterEach, describe, expect, it } from 'vitest';

import { BUILT_IN_DEFINITIONS } from '../task-catalog/built-in.js';
import { createFileLaunchStore } from '../task-catalog/launch/file-store.js';
import { LAUNCH_RECIPES } from '../task-catalog/launch/recipes.js';
import { keyOf, request, startWorld } from './launch-world.js';

import type { IWorldOptions, TWorld } from './launch-world.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

/** The state a host keeps, as directories a restart finds again. */
function disk() {
  const root = mkdtempSync(join(tmpdir(), 'task-launch-recovery-'));
  directories.push(root);
  const clock = { now: new Date('2026-11-24T10:00:00Z') };
  return {
    clock,
    boot: (options: IWorldOptions = {}): TWorld =>
      startWorld({
        goalStore: createFileGoalStore(join(root, 'goals')),
        launchStore: createFileLaunchStore({
          directory: join(root, 'task-catalog'),
          now: () => clock.now,
        }),
        clock,
        ...options,
      }),
  };
}

const crashed = async (world: TWorld): Promise<void> => {
  await expect(world.launches.start(request())).rejects.toThrow(/process died|goal store/u);
};

describe('a process that stopped between the steps of a start', () => {
  it('after the intent was kept and before any goal: the restart makes exactly one goal, once, and the same key then answers it', async () => {
    const state = disk();
    const first = state.boot({ dying: { goal: 'before', recording: true } });
    await crashed(first);
    expect(await first.goals.list()).toEqual([]);
    expect((await first.store.list()).map((entry) => entry.status)).toEqual(['reserved']);

    const second = state.boot();
    await second.launches.recover();
    const goals = await second.goals.list();
    expect(goals).toHaveLength(1);
    const [intent] = await second.store.list();
    expect(intent).toMatchObject({ status: 'launched', goalId: goals[0]!.id });
    expect(goals[0]!.launch).toEqual({ id: intent!.id });
    expect(second.onGoalReady).toHaveBeenCalledTimes(1);

    // Settling it again, or from yet another start, makes nothing more.
    await second.launches.recover();
    const third = state.boot();
    await third.launches.recover();
    expect(await third.goals.list()).toHaveLength(1);
    const retried = await third.launches.start(request());
    expect(retried).toMatchObject({ created: false, goalId: goals[0]!.id });
    expect(await third.goals.list()).toHaveLength(1);
  });

  it('after the goal was made and before the launch was recorded: the restart adopts that goal and makes no second', async () => {
    const state = disk();
    const first = state.boot({ dying: { recording: true } });
    await crashed(first);
    const [made] = await first.goals.list();
    expect(made).toBeDefined();
    expect((await first.store.list()).map((entry) => entry.status)).toEqual(['reserved']);
    // The goal is held back while its launch is not recorded.
    expect(await first.launches.mayStart(made!)).toBe(false);

    const second = state.boot();
    await second.launches.recover();
    expect((await second.goals.list()).map((goal) => goal.id)).toEqual([made!.id]);
    expect(await second.store.list()).toEqual([
      expect.objectContaining({ status: 'launched', goalId: made!.id }),
    ]);
    expect(second.create).not.toHaveBeenCalled();
    expect(await second.launches.mayStart(made!)).toBe(true);
  });

  it('adopts a goal that was made even when what the request rested on has changed since', async () => {
    const state = disk();
    const first = state.boot({ dying: { recording: true } });
    await crashed(first);
    const second = state.boot({ browser: { current: 'unavailable' } });
    await second.launches.recover();
    expect(await second.goals.list()).toHaveLength(1);
    expect((await second.store.list())[0]!.status).toBe('launched');
  });

  it('ends the intent as failed, with the reason and no goal, when the task is no longer ready', async () => {
    const state = disk();
    await crashed(state.boot({ dying: { goal: 'before', recording: true } }));
    const second = state.boot({ browser: { current: 'unavailable' } });
    await second.launches.recover();
    expect(await second.goals.list()).toEqual([]);
    const [intent] = await second.store.list();
    expect(intent).toMatchObject({
      status: 'failed',
      failure: { kind: 'stale', message: 'This task is no longer ready, so it was not started.' },
    });
    // The same key now gets that answer, and the goal is never made later under what changed.
    const again = await second.launches.start(request()).catch((error: unknown) => error);
    expect(again).toMatchObject({ kind: 'stale', detail: { launch: { status: 'failed' } } });
    expect(await second.goals.list()).toEqual([]);
    const back = state.boot();
    await back.launches.recover();
    expect(await back.goals.list()).toEqual([]);
    // A new key, now that it is ready again, is a new request.
    expect((await back.launches.start(request({ key: keyOf(2) }))).created).toBe(true);
  });

  it('ends the intent as failed when the task became one that needs setup', async () => {
    const state = disk();
    await crashed(state.boot({ dying: { goal: 'before', recording: true } }));
    const second = state.boot({ browser: { current: 'needs-setup' } });
    await second.launches.recover();
    expect(await second.goals.list()).toEqual([]);
    expect((await second.store.list())[0]).toMatchObject({ status: 'failed' });
  });

  it('ends the intent as failed when the task has a new revision, and when its words changed under the same one', async () => {
    const page = BUILT_IN_DEFINITIONS[3]!;
    const newRevision = { ...structuredClone(page), revision: 2 };
    const newWords = { ...structuredClone(page), expectedResult: 'Something else entirely.' };
    for (const [changed, recipes] of [
      [newRevision, [...LAUNCH_RECIPES, { ...LAUNCH_RECIPES[0]!, revision: 2 }]],
      [newWords, LAUNCH_RECIPES],
    ] as const) {
      const state = disk();
      await crashed(state.boot({ dying: { goal: 'before', recording: true } }));
      const second = state.boot({
        builtIn: [changed],
        recipes,
      });
      await second.launches.recover();
      expect(await second.goals.list()).toEqual([]);
      expect((await second.store.list())[0]).toMatchObject({
        status: 'failed',
        failure: {
          kind: 'stale',
          message: 'This task changed after you asked for it. Look at it again and start it again.',
        },
      });
    }
  });

  it('ends the intent as failed when the task has left the catalog', async () => {
    const state = disk();
    await crashed(state.boot({ dying: { goal: 'before', recording: true } }));
    const second = state.boot({ builtIn: [BUILT_IN_DEFINITIONS[0]!] });
    await second.launches.recover();
    expect((await second.store.list())[0]).toMatchObject({
      status: 'failed',
      failure: { message: 'This task is no longer in your catalog.' },
    });
  });

  it('ends a request that waited too long as failed, so it is never started days later', async () => {
    const state = disk();
    await crashed(state.boot({ dying: { goal: 'before', recording: true } }));
    state.clock.now = new Date('2026-11-26T10:00:00Z');
    const second = state.boot();
    await second.launches.recover();
    expect(await second.goals.list()).toEqual([]);
    expect((await second.store.list())[0]).toMatchObject({
      status: 'failed',
      failure: { kind: 'stale', message: expect.stringContaining('waited too long') },
    });
  });

  it('leaves what already ended alone', async () => {
    const state = disk();
    const first = state.boot();
    const started = await first.launches.start(request());
    const second = state.boot({ browser: { current: 'unavailable' } });
    await second.launches.recover();
    expect(await second.store.list()).toEqual([
      expect.objectContaining({ status: 'launched', goalId: started.goalId }),
    ]);
    expect(await second.goals.list()).toHaveLength(1);
  });

  it('does not stop the agent starting when a launch cannot be recorded, and settles it on the next start', async () => {
    const state = disk();
    await crashed(state.boot({ dying: { goal: 'before', recording: true } }));
    const second = state.boot({ dying: { recording: true } });
    await expect(second.launches.recover()).resolves.toBeUndefined();
    // Nothing could be recorded, so it stays reserved for the next start or retry to settle.
    expect((await second.store.list())[0]!.status).toBe('reserved');
    const third = state.boot();
    await third.launches.recover();
    expect((await third.store.list())[0]!.status).toBe('launched');
    expect(await third.goals.list()).toHaveLength(1);
  });

  it('settles a reserved intent a retry meets before any restart, making the one goal', async () => {
    const state = disk();
    const first = state.boot({ dying: { goal: 'before', recording: true } });
    await crashed(first);
    const second = state.boot();
    const retried = await second.launches.start(request());
    expect(retried.created).toBe(false);
    expect(await second.goals.list()).toHaveLength(1);
    expect((await second.store.list())[0]).toMatchObject({
      status: 'launched',
      goalId: retried.goalId,
    });
  });
});
