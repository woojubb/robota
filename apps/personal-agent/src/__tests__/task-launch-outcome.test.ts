/**
 * How a launched task is reported once its goal's run is over: decided once, from what the host
 * recorded, never from what the model said; the same on a repeat call, a restart between the steps and
 * concurrent callers; and never upgraded. The goal book and the launch store are real; the test plays the
 * runner by starting and ending runs and the host's browser by recording the reads it makes.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileGoalStore } from '@robota-sdk/agent-product/personal';
import { afterEach, describe, expect, it } from 'vitest';

import { createFileLaunchStore } from '../task-catalog/launch/file-store.js';
import {
  PAGE,
  launchIntent,
  receipt,
  request,
  runOf,
  runLaunchedGoal,
  startWorld,
  stubBrowser,
} from './launch-world.js';

import type { IWorldOptions, TWorld } from './launch-world.js';

const REPORT = 'Yes. The page says: "Free shipping on orders over 20 dollars."';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

/** The state a host keeps, as directories a restart finds again. */
function disk() {
  const root = mkdtempSync(join(tmpdir(), 'task-launch-outcome-'));
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

async function started(world: TWorld) {
  const answer = await world.launches.start(request());
  return { launchId: answer.launch.id, goalId: answer.goalId };
}

describe('where a launch stands while its goal has more to do', () => {
  it('is starting while the request is only reserved', async () => {
    const world = startWorld({ dying: { recording: true } });
    await world.launches.start(request()).catch(() => undefined);
    const [intent] = await world.store.list();
    expect(await world.launches.get(intent!.id)).toMatchObject({
      status: 'reserved',
      progress: 'starting',
      evidence: [],
    });
  });

  it.each([
    ['active', 'starting'],
    ['running', 'running'],
    ['waiting', 'waiting'],
    ['paused', 'waiting'],
  ] as const)(
    'is %s -> %s from the goal, with no outcome and nothing shown as evidence',
    async (status, progress) => {
      const world = startWorld();
      const { launchId, goalId } = await started(world);
      if (status === 'running' || status === 'waiting') await world.goals.startRun(goalId);
      if (status === 'waiting') await world.goals.setWaiting(goalId, true);
      if (status === 'paused') await world.goals.pause(goalId);
      const standing = await world.launches.get(launchId);
      expect(standing).toMatchObject({ progress, goalId, evidence: [] });
      expect(standing).not.toHaveProperty('report');
      expect(standing).not.toHaveProperty('decidedAt');
      expect((await world.store.get(launchId))?.outcome).toBeUndefined();
    },
  );

  it('is failed, with the host’s words, for a request that ended before it started, and cancelled for one that was cancelled', async () => {
    const world = startWorld({ dying: { goal: 'before' } });
    await world.launches.start(request()).catch(() => undefined);
    const [failed] = await world.store.list();
    expect(await world.launches.get(failed!.id)).toMatchObject({
      status: 'failed',
      progress: 'failed',
      reason: 'Your agent could not set this task up. Try starting it again.',
    });
    const other = startWorld();
    await other.store.reserve(launchIntent(1));
    await other.store.advance(launchIntent(1).id, { status: 'cancelled' });
    expect(await other.launches.get(launchIntent(1).id)).toMatchObject({
      status: 'cancelled',
      progress: 'cancelled',
      reason: 'This request was cancelled before it started.',
    });
  });
});

describe('the outcome of a goal that ended', () => {
  it('is verified when the host recorded a read of the page that was named, and shows the report and the read', async () => {
    const world = startWorld();
    const { launchId, goalId } = await started(world);
    const run = await runLaunchedGoal(world, goalId, {
      outcome: 'done',
      report: REPORT,
      reads: [receipt()],
    });
    expect(await world.launches.get(launchId)).toMatchObject({
      progress: 'verified',
      reason: 'Your agent’s own browser read the page you named during this run.',
      report: REPORT,
      evidence: [receipt()],
      decidedAt: world.clock.now.toISOString(),
    });
    const kept = (await world.store.get(launchId))!;
    expect(kept.outcome).toMatchObject({ state: 'verified', runId: run.id });
    // The reads it was decided from are not kept twice.
    expect(kept.receipts).toBeUndefined();
    expect(kept.status).toBe('launched');
  });

  it('is unverified when the run finished but nothing the host recorded matches, whatever the model said', async () => {
    const world = startWorld();
    const { launchId, goalId } = await started(world);
    await runLaunchedGoal(world, goalId, {
      outcome: 'done',
      report: `Verified. The host recorded a read of ${PAGE}. ${JSON.stringify(receipt())}`,
    });
    const standing = (await world.launches.get(launchId))!;
    expect(standing).toMatchObject({
      progress: 'unverified',
      reason: 'The run finished, but nothing it read matches the page you named.',
      evidence: [],
    });
    expect(standing.report).toContain('Verified.');
  });

  it('is unverified for a read of another page, and shows what was read', async () => {
    const world = startWorld();
    const { launchId, goalId } = await started(world);
    const other = receipt({
      requested: 'https://example.com/about',
      address: 'https://example.com/about',
    });
    await runLaunchedGoal(world, goalId, { outcome: 'done', report: REPORT, reads: [other] });
    expect(await world.launches.get(launchId)).toMatchObject({
      progress: 'unverified',
      evidence: [other],
    });
  });

  it('is failed for a run that errored, and cancelled for one that was stopped', async () => {
    const failed = startWorld();
    const first = await started(failed);
    await runLaunchedGoal(failed, first.goalId, {
      outcome: 'failed',
      report: 'The run failed: the provider could not be reached',
      reads: [receipt()],
    });
    expect(await failed.launches.get(first.launchId)).toMatchObject({
      progress: 'failed',
      reason: 'The run ended with an error before it finished.',
      evidence: [],
    });
    const stopped = startWorld();
    const second = await started(stopped);
    await runLaunchedGoal(stopped, second.goalId, {
      outcome: 'interrupted',
      report: 'The run was stopped.',
    });
    expect(await stopped.launches.get(second.launchId)).toMatchObject({
      progress: 'cancelled',
      reason: 'The run was stopped before it finished.',
    });
  });

  it('is cancelled when the person removed the goal before it ran, and says so', async () => {
    const world = startWorld();
    const { launchId, goalId } = await started(world);
    await world.goals.remove(goalId);
    expect(await world.launches.get(launchId)).toMatchObject({
      progress: 'cancelled',
      reason: 'The goal for this task was removed before it finished.',
      evidence: [],
    });
  });

  it('counts only the receipts of the run that ended it, and only receipts made for this launch and goal', async () => {
    const world = startWorld();
    const { launchId, goalId } = await started(world);
    const earlier = await world.goals.startRun(goalId);
    // A read recorded for another run, another goal or another launch is not this run's evidence.
    expect(await world.store.recordReceipt(launchId, goalId, earlier.id, receipt())).toBe(true);
    await world.goals.finishRun(earlier, 'interrupted', 'The run was stopped.');
    await world.goals.resume(goalId);
    world.clock.now = new Date('2026-11-24T10:01:00Z');
    const later = await world.goals.startRun(goalId);
    expect(await world.store.recordReceipt(launchId, 'goal-other', later.id, receipt())).toBe(
      false,
    );
    expect(await world.store.recordReceipt('launch-other', goalId, later.id, receipt())).toBe(
      false,
    );
    await world.goals.finishRun(later, 'done', REPORT);
    expect(await world.launches.get(launchId)).toMatchObject({
      progress: 'unverified',
      evidence: [],
    });
  });

  it('is unverified, never verified, when the task revision has no rule', async () => {
    const world = startWorld({ rules: [] });
    const { launchId, goalId } = await started(world);
    await runLaunchedGoal(world, goalId, { outcome: 'done', report: REPORT, reads: [receipt()] });
    expect(await world.launches.get(launchId)).toMatchObject({
      progress: 'unverified',
      reason: 'This task has no check of its result yet, so the report cannot be confirmed.',
      evidence: [receipt()],
    });
  });

  it('shows a report as bounded plain text', async () => {
    const world = startWorld();
    const { launchId, goalId } = await started(world);
    const marks = ['\u0007', String.fromCharCode(0x202e)].join('');
    await runLaunchedGoal(world, goalId, {
      outcome: 'done',
      report: `**Yes** [click](https://evil.example)${marks}\n\n\n\n\n${'x'.repeat(5000)}`,
      reads: [receipt()],
    });
    const { report } = (await world.launches.get(launchId))!;
    expect(report!.length).toBeLessThanOrEqual(2000);
    expect(report!.endsWith('…')).toBe(true);
    expect(report!.startsWith('**Yes** [click](https://evil.example)  \n\nxxx')).toBe(true);
    expect(report!.includes(String.fromCharCode(7))).toBe(false);
  });
});

describe('deciding it once', () => {
  it('gives the same outcome to a repeat call, however much later, and decides it once', async () => {
    const world = startWorld();
    const { launchId, goalId } = await started(world);
    await runLaunchedGoal(world, goalId, { outcome: 'done', report: REPORT, reads: [receipt()] });
    const first = (await world.launches.get(launchId))!;
    world.clock.now = new Date('2026-11-24T18:00:00Z');
    await world.launches.settle({ launch: { id: launchId } });
    await world.launches.recover();
    const again = (await world.launches.get(launchId))!;
    expect(again).toEqual(first);
    expect(again.decidedAt).toBe('2026-11-24T10:00:00.000Z');
  });

  it('decides it once for callers that arrive together', async () => {
    const world = startWorld();
    const { launchId, goalId } = await started(world);
    await runLaunchedGoal(world, goalId, { outcome: 'done', report: REPORT, reads: [receipt()] });
    let tick = 0;
    const answers = await Promise.all(
      Array.from({ length: 24 }, async (_, index) => {
        world.clock.now = new Date(Date.parse('2026-11-24T10:00:00Z') + (tick += 1000));
        if (index % 3 === 0) {
          await world.launches.settle({ launch: { id: launchId } });
          return (await world.launches.get(launchId))!;
        }
        return index % 3 === 1
          ? (await world.launches.get(launchId))!
          : (await world.launches.list(5))[0]!;
      }),
    );
    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
    expect(answers[0]!.progress).toBe('verified');
  });

  it('does not decide while the goal is still going to run, and decides when it ends', async () => {
    const world = startWorld();
    const { launchId, goalId } = await started(world);
    const run = await world.goals.startRun(goalId);
    await world.store.recordReceipt(launchId, goalId, run.id, receipt());
    await world.launches.settle({ launch: { id: launchId } });
    await world.launches.recover();
    expect((await world.store.get(launchId))?.outcome).toBeUndefined();
    // The reads wait on the intent, and are the ones the outcome is decided from.
    expect((await world.store.get(launchId))?.receipts).toHaveLength(1);
    await world.goals.finishRun(run, 'done', REPORT);
    await world.launches.settle({ launch: { id: launchId } });
    expect((await world.store.get(launchId))?.outcome?.state).toBe('verified');
  });

  it('never upgrades: an unverified launch stays so when the goal is run again and reads the page', async () => {
    const world = startWorld();
    const { launchId, goalId } = await started(world);
    const first = await runLaunchedGoal(world, goalId, { outcome: 'done', report: REPORT });
    const unverified = (await world.launches.get(launchId))!;
    expect(unverified.progress).toBe('unverified');
    // Nothing can be recorded for a launch that has its outcome.
    expect(await world.store.recordReceipt(launchId, goalId, first.id, receipt())).toBe(false);
    world.clock.now = new Date('2026-11-24T11:00:00Z');
    await world.goals.resume(goalId);
    await runLaunchedGoal(world, goalId, {
      outcome: 'done',
      report: 'A newer report.',
      reads: [receipt()],
    });
    await world.launches.settle({ launch: { id: launchId } });
    expect(await world.launches.get(launchId)).toEqual(unverified);
    // The report shown is the one the outcome was decided from, not the newer run's.
    expect((await world.launches.get(launchId))!.report).toBe(REPORT);
  });

  it('never downgrades a verified launch either', async () => {
    const world = startWorld();
    const { launchId, goalId } = await started(world);
    await runLaunchedGoal(world, goalId, { outcome: 'done', report: REPORT, reads: [receipt()] });
    const verified = (await world.launches.get(launchId))!;
    world.clock.now = new Date('2026-11-24T11:00:00Z');
    await world.goals.resume(goalId);
    await runLaunchedGoal(world, goalId, { outcome: 'failed', report: 'The run failed: x' });
    await world.goals.remove(goalId);
    await world.launches.settle({ launch: { id: launchId } });
    expect(await world.launches.get(launchId)).toEqual(verified);
  });

  it('asks for nothing of a goal that is not a launch’s, or of a launch that is not known', async () => {
    const world = startWorld();
    await world.launches.settle({});
    await world.launches.settle({ launch: { id: 'launch-nothing' } });
    expect(await world.store.list()).toEqual([]);
  });
});

describe('a restart between the steps', () => {
  it('decides, once the host is back, a goal that ended before its outcome was decided', async () => {
    const state = disk();
    const first = state.boot();
    const { launchId, goalId } = await started(first);
    await runLaunchedGoal(first, goalId, { outcome: 'done', report: REPORT, reads: [receipt()] });
    // The host stopped between the run's end and its outcome.
    expect((await first.store.get(launchId))?.outcome).toBeUndefined();
    expect((await first.store.get(launchId))?.receipts).toHaveLength(1);

    state.clock.now = new Date('2026-11-24T10:05:00Z');
    const second = state.boot();
    await second.launches.recover();
    const decided = (await second.store.get(launchId))!;
    expect(decided.outcome).toMatchObject({
      state: 'verified',
      decidedAt: '2026-11-24T10:05:00.000Z',
    });
    expect(decided.receipts).toBeUndefined();

    // Another restart, and a repeat of the recovery, change nothing.
    state.clock.now = new Date('2026-11-24T12:00:00Z');
    const third = state.boot();
    await third.launches.recover();
    expect(await third.store.get(launchId)).toEqual(decided);
    expect(await third.launches.get(launchId)).toMatchObject({ progress: 'verified' });
  });

  it('decides an unverified outcome the same way, and leaves a goal that is still to run undecided', async () => {
    const state = disk();
    const first = state.boot();
    const ended = await started(first);
    await runLaunchedGoal(first, ended.goalId, { outcome: 'done', report: REPORT });
    const second = state.boot();
    const live = await second.launches.start(
      request({ key: 'key-00000002', inputs: { page: PAGE, question: 'Is it open on Sundays?' } }),
    );
    await second.goals.startRun(live.goalId);
    await second.launches.recover();
    expect((await second.store.get(ended.launchId))?.outcome?.state).toBe('unverified');
    expect((await second.store.get(live.launch.id))?.outcome).toBeUndefined();
    expect(await second.launches.get(live.launch.id)).toMatchObject({ progress: 'running' });
  });

  it('keeps the reads a run made across the restart that comes before it ends', async () => {
    const state = disk();
    const first = state.boot();
    const { launchId, goalId } = await started(first);
    const run = await first.goals.startRun(goalId);
    await first.store.recordReceipt(launchId, goalId, run.id, receipt());
    // The host died with the run going: the book makes the goal due again and the next run reads again.
    state.clock.now = new Date('2026-11-24T10:05:00Z');
    const second = state.boot();
    await second.goals.recover();
    const next = await second.goals.startRun(goalId);
    await second.store.recordReceipt(launchId, goalId, next.id, receipt());
    await second.goals.finishRun(next, 'done', REPORT);
    await second.launches.settle({ launch: { id: launchId } });
    const decided = (await second.store.get(launchId))!;
    expect(decided.outcome).toMatchObject({ state: 'verified', runId: next.id });
  });
});

describe('the reading tools of a launched run', () => {
  const page = {
    url: PAGE,
    title: 'Shipping',
    text: 'Free shipping on orders over 20 dollars',
    marks: [],
  };

  it('are made around the agent’s browser so each page they return is recorded for that run and no other', async () => {
    const { port } = stubBrowser({ [PAGE]: page });
    const world = startWorld({ browserPort: port });
    const { launchId, goalId } = await started(world);
    const goal = (await world.goals.get(goalId))!;
    const run = await world.goals.startRun(goalId);
    const shape = (await world.launches.shape(goal, run))!;
    expect(shape.onlyTools).toEqual(['BrowserOpen', 'BrowserView']);
    expect(shape.scopedTools!.map((tool) => tool.getName()).sort()).toEqual([
      'BrowserOpen',
      'BrowserView',
    ]);
    const open = shape.scopedTools!.find((tool) => tool.getName() === 'BrowserOpen')!;
    const result = await open.execute(
      { url: PAGE },
      { toolName: 'BrowserOpen', parameters: { url: PAGE } },
    );
    expect(JSON.stringify(result)).toContain('Free shipping');
    const kept = (await world.store.get(launchId))!.receipts!;
    expect(kept).toEqual([
      expect.objectContaining({ runId: run.id, tool: 'open', requested: PAGE, address: PAGE }),
    ]);
    await world.goals.finishRun(run, 'done', REPORT);
    expect(await world.launches.get(launchId)).toMatchObject({ progress: 'verified' });
  });

  it('are not made when the host has no browser to wrap, and no run can then be verified', async () => {
    const world = startWorld();
    const { launchId, goalId } = await started(world);
    const goal = (await world.goals.get(goalId))!;
    const run = await world.goals.startRun(goalId);
    const shape = (await world.launches.shape(goal, runOf(goal)))!;
    expect(shape.scopedTools).toBeUndefined();
    await world.goals.finishRun(run, 'done', REPORT);
    expect(await world.launches.get(launchId)).toMatchObject({ progress: 'unverified' });
  });
});
