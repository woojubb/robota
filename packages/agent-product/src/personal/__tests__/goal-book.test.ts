import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  GoalBook,
  GoalRefusedError,
  createFileGoalStore,
  createGoalTools,
  createMemoryGoalStore,
} from '../index.js';

import type { TToolParameters } from '@robota-sdk/agent-core';

import type { IFeedItem, IGoalStore } from '../index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fileStore(): { store: IGoalStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'goals-'));
  dirs.push(dir);
  return { store: createFileGoalStore(dir), dir };
}

/** A clock the test moves by hand. */
function clock(start = Date.UTC(2026, 10, 14, 9, 0, 0)) {
  let now = start;
  return { now: () => new Date(now), advance: (minutes: number) => (now += minutes * 60_000) };
}

it('assigns distinct approval ids to separate books at the same instant', async () => {
  const { store, dir } = fileStore();
  const now = clock().now;
  const first = new GoalBook({ store, now });
  const second = new GoalBook({ store: createFileGoalStore(dir), now });
  const entry = (detail: string) => ({
    kind: 'approval' as const,
    title: 'Case',
    body: '',
    approval: { tool: 'ConnectorAct', detail, state: 'pending' as const },
  });
  const alice = await first.post(entry('alice'));
  const bob = await second.post(entry('bob'));
  expect(alice.id).not.toBe(bob.id);
  expect((await first.feedItem(alice.id))?.approval?.detail).toBe('alice');
  expect((await second.feedItem(bob.id))?.approval?.detail).toBe('bob');
});

describe.each([
  ['memory', () => createMemoryGoalStore()],
  ['file', () => fileStore().store],
])('goal book over a %s store', (_name, makeStore) => {
  it('does not recover a later case run using an earlier run identity', async () => {
    const book = new GoalBook({ store: makeStore() });
    const first = await book.enqueueCaseAnswer({
      caseId: 'case-one',
      feedItemId: 'feed-one',
      ownerId: 'owner',
      title: 'Case',
      instructions: 'Review.',
    });
    const oldRun = await book.startRun(first.id, { ownerId: 'owner' });
    expect(await book.recoverCaseOwner(first.id, 'owner', 'owner', oldRun.id)).toBe(true);
    await book.enqueueCaseAnswer({
      caseId: 'case-one',
      feedItemId: 'feed-two',
      ownerId: 'owner',
      title: 'Case',
      instructions: 'Review.',
    });
    const newRun = await book.startRun(first.id, { ownerId: 'owner' });
    expect(await book.recoverCaseOwner(first.id, 'owner', 'owner', oldRun.id)).toBe(false);
    expect((await book.get(first.id))?.activeCaseRun?.runId).toBe(newRun.id);
    expect(
      (await book.runs(first.id)).find((run) => run.id === newRun.id)?.endedAt,
    ).toBeUndefined();
  });

  it('makes a new goal due at once and a repeating one due again after its interval', async () => {
    const time = clock();
    const book = new GoalBook({ store: makeStore(), now: time.now });
    const goal = await book.create({
      title: 'Concert prices',
      instructions: 'Check the ticket price',
      everyMinutes: 60,
    });
    expect((await book.due()).map((due) => due.id)).toEqual([goal.id]);

    const run = await book.startRun(goal.id);
    expect((await book.get(goal.id))?.status).toBe('running');
    expect(await book.due()).toEqual([]);
    const acted = await book.recordAction(run, {
      tool: 'BrowserOpen',
      detail: 'https://tickets.example/',
      outcome: 'done',
    });
    await book.finishRun(acted, 'done', 'Tickets are 30 dollars.');

    const after = (await book.get(goal.id))!;
    expect(after.status).toBe('active');
    expect(await book.due()).toEqual([]);
    time.advance(60);
    expect((await book.due()).map((due) => due.id)).toEqual([goal.id]);

    const [recorded] = await book.runs(goal.id);
    expect(recorded).toEqual(
      expect.objectContaining({ outcome: 'done', report: 'Tickets are 30 dollars.' }),
    );
    expect(recorded!.actions).toEqual([
      expect.objectContaining({ tool: 'BrowserOpen', outcome: 'done' }),
    ]);
    const [report] = await book.feed();
    expect(report).toEqual(
      expect.objectContaining({
        kind: 'report',
        title: 'Concert prices',
        body: 'Tickets are 30 dollars.',
        goalId: goal.id,
      }),
    );
  });

  it('closes a one-off goal when its run ends, and marks a failed one', async () => {
    const book = new GoalBook({ store: makeStore(), now: clock().now });
    const once = await book.create({ title: 'Book a table', instructions: 'Find a table for two' });
    await book.finishRun(await book.startRun(once.id), 'done', 'Booked.');
    expect((await book.get(once.id))?.status).toBe('done');
    const broken = await book.create({ title: 'Broken', instructions: 'x' });
    await book.finishRun(await book.startRun(broken.id), 'failed', 'The site was down.');
    expect((await book.get(broken.id))?.status).toBe('failed');
    expect((await book.feed())[0]?.title).toBe('Broken (failed)');
  });

  it('pauses, resumes and stops goals, but not one that is running', async () => {
    const book = new GoalBook({ store: makeStore(), now: clock().now });
    const goal = await book.create({ title: 'Watch', instructions: 'x', everyMinutes: 5 });
    expect((await book.pause(goal.id)).status).toBe('paused');
    expect(await book.due()).toEqual([]);
    expect((await book.resume(goal.id)).status).toBe('active');
    await book.startRun(goal.id);
    await expect(book.pause(goal.id)).rejects.toThrow(GoalRefusedError);
    await expect(book.remove(goal.id)).rejects.toThrow(GoalRefusedError);
    const other = await book.create({ title: 'Other', instructions: 'x' });
    await book.remove(other.id);
    expect(await book.get(other.id)).toBeUndefined();
  });

  it('keeps the case a goal gives a turn on, and no case on any other goal', async () => {
    const book = new GoalBook({ store: makeStore(), now: clock().now });
    const turn = await book.create({
      title: 'Case: Sign-in',
      instructions: 'x',
      readOnly: true,
      caseId: 'case-1',
    });
    expect((await book.get(turn.id))?.caseId).toBe('case-1');
    expect((await book.list()).find((goal) => goal.caseId === 'case-1')?.id).toBe(turn.id);
    expect(await book.create({ title: 'Plain', instructions: 'x' })).not.toHaveProperty('caseId');
  });

  it('keeps the launch a goal was made for, and makes one goal for one launch however often it is asked', async () => {
    const book = new GoalBook({ store: makeStore(), now: clock().now });
    const made = await book.create({
      title: 'Check a page',
      instructions: 'Look.',
      readOnly: true,
      launch: { id: 'launch-1' },
    });
    expect((await book.get(made.id))?.launch).toEqual({ id: 'launch-1' });
    const again = await Promise.all(
      Array.from({ length: 10 }, () =>
        book.create({ title: 'Check a page', instructions: 'Look.', launch: { id: 'launch-1' } }),
      ),
    );
    expect(again.map((goal) => goal.id)).toEqual(Array(10).fill(made.id));
    const other = await book.create({
      title: 'Check a page',
      instructions: 'Look.',
      launch: { id: 'launch-2' },
    });
    expect(other.id).not.toBe(made.id);
    expect(await book.list()).toHaveLength(2);
    expect(await book.create({ title: 'Plain', instructions: 'x' })).not.toHaveProperty('launch');
  });

  it('refuses a launch id that is not a short id', async () => {
    const book = new GoalBook({ store: makeStore(), now: clock().now });
    for (const id of ['', 'Launch 1', 'x'.repeat(81), '../other', 'launch_1'])
      await expect(
        book.create({ title: 'x', instructions: 'y', launch: { id } }),
        id,
      ).rejects.toThrow(GoalRefusedError);
    expect(await book.list()).toEqual([]);
  });

  it('runs a finished one-off goal again, and refuses one that is running, waiting or paused', async () => {
    const time = clock();
    const book = new GoalBook({ store: makeStore(), now: time.now });
    const goal = await book.create({ title: 'Case', instructions: 'x', caseId: 'case-1' });
    await book.finishRun(await book.startRun(goal.id), 'done', 'Settled.');
    expect((await book.get(goal.id))?.status).toBe('done');
    expect(await book.due()).toEqual([]);

    time.advance(1);
    const again = await book.runAgain(goal.id);
    expect(again).toEqual(
      expect.objectContaining({ status: 'active', nextRunAt: time.now().toISOString() }),
    );
    expect((await book.due()).map((due) => due.id)).toEqual([goal.id]);

    const second = await book.startRun(goal.id);
    await expect(book.runAgain(goal.id)).rejects.toThrow(/running/u);
    await book.setWaiting(goal.id, true);
    await expect(book.runAgain(goal.id)).rejects.toThrow(GoalRefusedError);
    expect((await book.get(goal.id))?.status).toBe('waiting');
    await book.setWaiting(goal.id, false);

    await book.finishRun(second, 'failed', 'The run failed.');
    expect((await book.get(goal.id))?.status).toBe('failed');
    expect((await book.runAgain(goal.id)).status).toBe('active');

    await book.pause(goal.id);
    await expect(book.runAgain(goal.id)).rejects.toThrow(/paused/u);
    expect((await book.get(goal.id))?.status).toBe('paused');
    await expect(book.runAgain('goal-nothing')).rejects.toThrow(GoalRefusedError);
  });

  it('keeps a scheduled goal on its own interval when it is run again', async () => {
    const time = clock();
    const book = new GoalBook({ store: makeStore(), now: time.now });
    const goal = await book.create({ title: 'Watch', instructions: 'x', everyMinutes: 60 });
    await book.finishRun(await book.startRun(goal.id), 'done', 'Nothing new.');
    expect(await book.due()).toEqual([]);

    const again = await book.runAgain(goal.id);
    expect(again.everyMinutes).toBe(60);
    expect((await book.due()).map((due) => due.id)).toEqual([goal.id]);

    time.advance(10);
    await book.finishRun(await book.startRun(goal.id), 'done', 'Nothing new.');
    const after = (await book.get(goal.id))!;
    expect(after).toEqual(expect.objectContaining({ status: 'active', everyMinutes: 60 }));
    expect(after.nextRunAt).toBe(new Date(time.now().getTime() + 60 * 60_000).toISOString());
  });

  it('keeps an approval in the feed until the person answers it', async () => {
    const book = new GoalBook({ store: makeStore(), now: clock().now });
    const goal = await book.create({ title: 'Buy tickets', instructions: 'x' });
    const item = await book.post({
      kind: 'approval',
      title: 'Buy tickets',
      body: 'BrowserSubmit wants to send a form',
      goalId: goal.id,
      approval: {
        tool: 'BrowserSubmit',
        detail: 'POST https://tickets.example/buy',
        state: 'pending',
      },
    });
    await expect(book.dismiss(item.id)).rejects.toThrow('Answer the approval');
    expect((await book.setApproval(item.id, 'approved')).approval?.state).toBe('approved');
    await book.dismiss(item.id);
    expect((await book.feedItem(item.id))?.dismissed).toBe(true);
  });

  it('after a restart, runs again what was running and expires approvals nobody can answer any more', async () => {
    const store = makeStore();
    const book = new GoalBook({ store, now: clock().now });
    const goal = await book.create({ title: 'Buy tickets', instructions: 'x' });
    await book.startRun(goal.id);
    await book.setWaiting(goal.id, true);
    const item = await book.post({
      kind: 'approval',
      title: 'Buy tickets',
      body: 'waiting',
      goalId: goal.id,
      approval: { tool: 'BrowserSubmit', detail: 'POST', state: 'pending' },
    });
    const restarted = new GoalBook({ store, now: clock().now });
    expect(await restarted.recover()).toBe(1);
    expect((await restarted.get(goal.id))?.status).toBe('active');
    expect((await restarted.runs(goal.id))[0]?.outcome).toBe('interrupted');
    expect((await restarted.feedItem(item.id))?.approval?.state).toBe('expired');
    expect((await restarted.due()).map((due) => due.id)).toEqual([goal.id]);
  });

  it('recovers only the selected interrupted goal and its approval', async () => {
    const book = new GoalBook({ store: makeStore(), now: clock().now });
    const first = await book.create({ title: 'First', instructions: 'x' });
    const second = await book.create({ title: 'Second', instructions: 'x' });
    const items = [];
    for (const goal of [first, second]) {
      await book.startRun(goal.id);
      await book.setWaiting(goal.id, true);
      items.push(
        await book.post({
          kind: 'approval',
          title: goal.title,
          body: 'waiting',
          goalId: goal.id,
          approval: { tool: 'BrowserSubmit', detail: 'POST', state: 'pending' },
        }),
      );
    }
    expect(await book.recoverGoal(first.id)).toBe(true);
    expect((await book.get(first.id))?.status).toBe('active');
    expect((await book.get(second.id))?.status).toBe('waiting');
    expect((await book.feedItem(items[0]!.id))?.approval?.state).toBe('expired');
    expect((await book.feedItem(items[1]!.id))?.approval?.state).toBe('pending');
    expect(await book.recoverGoal(first.id)).toBe(false);
  });

  it.each(['all', 'one'] as const)(
    'settles every unfinished run while recovering %s goals',
    async (mode) => {
      const book = new GoalBook({ store: makeStore(), now: clock().now });
      const goal = await book.create({ title: 'Interrupted', instructions: 'x' });
      await book.startRun(goal.id);
      await book.startRun(goal.id);
      if (mode === 'all') await book.recover();
      else await book.recoverGoal(goal.id);
      const runs = await book.runs(goal.id);
      expect(runs).toHaveLength(2);
      expect(runs.map((run) => run.outcome)).toEqual(['interrupted', 'interrupted']);
      expect((await book.get(goal.id))?.status).toBe('active');
    },
  );

  it.each(['all', 'one'] as const)(
    'settles an unfinished run even when its goal is still active: %s',
    async (mode) => {
      const store = makeStore();
      const book = new GoalBook({ store, now: clock().now });
      const goal = await book.create({ title: 'Interrupted', instructions: 'x' });
      await store.putRun({
        id: 'run-orphan',
        goalId: goal.id,
        startedAt: goal.createdAt,
        actions: [],
      });
      if (mode === 'all') await book.recover();
      else await book.recoverGoal(goal.id);
      expect((await book.runs(goal.id))[0]?.outcome).toBe('interrupted');
      expect((await book.get(goal.id))?.status).toBe('active');
    },
  );

  it('refuses a goal without instructions, a bad interval, and secrets', async () => {
    const book = new GoalBook({ store: makeStore(), now: clock().now });
    await expect(book.create({ title: 'x', instructions: ' ' })).rejects.toThrow(GoalRefusedError);
    await expect(book.create({ title: 'x', instructions: 'y', everyMinutes: 0 })).rejects.toThrow(
      GoalRefusedError,
    );
    await expect(
      book.create({ title: 'Login', instructions: 'use password: hunter2-very-secret' }),
    ).rejects.toThrow(GoalRefusedError);
  });
});

describe('goal file store', () => {
  it('treats an id that names an object property as unknown, and leaves the files intact', async () => {
    const { store, dir } = fileStore();
    const book = new GoalBook({ store, now: clock().now });
    await book.post({ kind: 'notice', title: 'Hello', body: 'x' });
    for (const id of ['constructor', '__proto__', 'toString']) {
      expect(await book.get(id)).toBeUndefined();
      await expect(book.pause(id)).rejects.toThrow(GoalRefusedError);
      await expect(book.dismiss(id)).rejects.toThrow(GoalRefusedError);
    }
    await book.post({ kind: 'notice', title: 'Still works', body: 'y' });
    expect((await book.feed()).map((item) => item.title)).toEqual(['Still works', 'Hello']);
    // Nothing was written for those ids: no goal file came into being.
    expect(existsSync(join(dir, 'goals.json'))).toBe(false);
  });

  it('keeps a waiting approval when the feed is trimmed to its bound', async () => {
    const time = clock();
    const { store, dir } = fileStore();
    const book = new GoalBook({ store, now: time.now });
    const approval = await book.post({
      kind: 'approval',
      title: 'Buy',
      body: 'x',
      approval: { tool: 'BrowserSubmit', detail: 'POST', state: 'pending' },
    });
    // Fill the feed to its bound by writing the store's own file format once: every post
    // rewrites the whole file with a synced atomic write, so 500 posts would take seconds.
    const seeded: Record<string, IFeedItem> = {
      [approval.id]: (await store.getFeedItem(approval.id))!,
    };
    for (let index = 0; index < 499; index += 1) {
      time.advance(1);
      const id = `feed-seed${String(index).padStart(4, '0')}`;
      seeded[id] = {
        id,
        at: time.now().toISOString(),
        kind: 'notice',
        title: `n${index}`,
        body: 'x',
        dismissed: false,
      };
    }
    writeFileSync(join(dir, 'feed.json'), JSON.stringify(seeded));
    expect(await book.feed(1000)).toHaveLength(500);
    // Posts past the bound trim through the real store path.
    for (let index = 0; index < 2; index += 1) {
      time.advance(1);
      await book.post({ kind: 'notice', title: `late${index}`, body: 'x' });
    }
    const feed = await book.feed(1000);
    expect(feed).toHaveLength(500);
    expect(feed.some((item) => item.id === approval.id)).toBe(true);
  });

  it('keeps owner-only JSON files', async () => {
    const { store, dir } = fileStore();
    const book = new GoalBook({ store, now: clock().now });
    const goal = await book.create({ title: 'Check mail', instructions: 'x' });
    await book.finishRun(await book.startRun(goal.id), 'done', 'Nothing new.');
    expect(JSON.parse(readFileSync(join(dir, 'goals.json'), 'utf8'))[goal.id].title).toBe(
      'Check mail',
    );
    expect(readFileSync(join(dir, 'feed.json'), 'utf8')).toContain('Nothing new.');
    if (process.platform !== 'win32') {
      for (const file of ['goals.json', 'feed.json', join('runs', `${goal.id}.json`)]) {
        expect(statSync(join(dir, file)).mode & 0o777, file).toBe(0o600);
      }
    }
  });
});

describe('goal tools', () => {
  it('create, list and steer goals, and turn a refusal into a message for the model', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore(), now: clock().now });
    const tools = Object.fromEntries(createGoalTools(book).map((tool) => [tool.schema.name, tool]));
    const call = async (name: string, args: TToolParameters) =>
      JSON.stringify((await tools[name]!.execute(args, { toolName: name, parameters: {} })).data);
    const created = JSON.parse(
      JSON.parse(
        await call('GoalCreate', {
          title: 'Weather',
          instructions: 'Check rain',
          everyMinutes: 30,
        }),
      ),
    );
    expect(created.status).toBe('active');
    expect(await call('GoalList', {})).toContain('Weather');
    expect(await call('GoalUpdate', { id: created.created, action: 'pause' })).toContain('paused');
    expect(await call('GoalUpdate', { id: 'nope', action: 'pause' })).toContain('No goal nope');
  });
});
