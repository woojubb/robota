import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
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

import type { IGoalStore } from '../index.js';

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

describe.each([
  ['memory', () => createMemoryGoalStore()],
  ['file', () => fileStore().store],
])('goal book over a %s store', (_name, makeStore) => {
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
