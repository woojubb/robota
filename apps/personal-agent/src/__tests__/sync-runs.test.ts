/**
 * How a sync run is told where to start and when it is worth reporting, with the goal book and the
 * library in memory and a service whose state a test sets.
 */
import { describe, expect, it } from 'vitest';

import {
  ConnectorBook,
  GoalBook,
  KnowledgeWiki,
  createMemoryConnectorStore,
  createMemoryGoalStore,
  createMemoryKnowledgeStore,
} from '@robota-sdk/agent-product/personal';

import { createSyncRuns } from '../connectors/sync-runs.js';

import type { ConnectorRegistry, IGoal } from '@robota-sdk/agent-product/personal';

async function setup(state: 'connected' | 'needs-sign-in' = 'connected') {
  const clock = { now: new Date('2026-11-15T10:00:00.000Z') };
  const goals = new GoalBook({ store: createMemoryGoalStore(), now: () => clock.now });
  const book = new ConnectorBook({ store: createMemoryConnectorStore() });
  const wiki = new KnowledgeWiki({ store: createMemoryKnowledgeStore() });
  const mail = await book.create({
    title: 'Work mail',
    kind: 'mail',
    protocol: 'mcp',
    endpoint: 'https://mail.example/mcp',
  });
  /** What the registry says about reads on the connector; a test moves it as a run would. */
  const reads = { succeeded: 0, failed: 0 };
  const registry = {
    view: async () => ({ connector: mail, status: { state } }),
    readCounts: () => ({ ...reads }),
  } as unknown as ConnectorRegistry;
  const goal = await goals.create({
    title: 'Keep Work mail in sync',
    instructions: 'Check it.',
    everyMinutes: 60,
    connectorId: mail.id,
  });
  const advance = (minutes: number): void => {
    clock.now = new Date(clock.now.getTime() + minutes * 60_000);
  };
  return {
    reads,
    goals,
    book,
    wiki,
    mail,
    goal,
    advance,
    runs: createSyncRuns({ book, registry, goals, wiki }),
  };
}

async function runAs(
  goals: GoalBook,
  goal: IGoal,
  outcome: 'done' | 'failed' | 'interrupted',
  advance: (minutes: number) => void,
) {
  const run = await goals.startRun(goal.id);
  advance(5);
  await goals.finishRun(run, outcome, outcome, { quiet: true });
  advance(55);
  return run;
}

describe('where a sync run starts reading', () => {
  it('is a first sync when no run has finished well', async () => {
    const { runs, goal, goals } = await setup();
    await goals.startRun(goal.id);
    const shape = await runs.shape((await goals.get(goal.id))!);
    expect(shape?.instructions).toContain('first sync');
  });

  it('starts where the last run that finished well began, not after a run that failed or was cut short', async () => {
    const { runs, goal, goals, advance } = await setup();
    const good = await runAs(goals, goal, 'done', advance);
    await runAs(goals, goal, 'failed', advance);
    await runAs(goals, goal, 'interrupted', advance);
    await goals.startRun(goal.id);
    const shape = await runs.shape((await goals.get(goal.id))!);
    expect(shape?.instructions).toContain(good.startedAt);
    expect(shape?.instructions).not.toContain('first sync');
  });

  it('shapes only a goal that keeps a connector in sync', async () => {
    const { runs, goals } = await setup();
    const own = await goals.create({ title: 'Plan the week', instructions: 'Plan it.' });
    expect(await runs.shape(own)).toBeUndefined();
    expect(await runs.quiet(own)).toBe(false);
  });
});

describe('whether a sync run is worth reporting', () => {
  it('is quiet when the service is reachable, it was read, no read failed and nothing was added', async () => {
    const { runs, goal, reads } = await setup();
    await runs.shape(goal);
    reads.succeeded += 1;
    expect(await runs.quiet(goal)).toBe(true);
  });

  it('is reported when it added something to the library', async () => {
    const { runs, goal, wiki, mail, reads } = await setup();
    await runs.shape(goal);
    reads.succeeded += 1;
    await wiki.remember({
      pageTitle: 'Mina',
      claim: 'Dinner on Friday',
      source: { origin: 'mail', reference: `connector:${mail.id} Plans` },
    });
    expect(await runs.quiet(goal)).toBe(false);
  });

  it('is reported when it never read the service at all', async () => {
    const { runs, goal } = await setup();
    await runs.shape(goal);
    expect(await runs.quiet(goal)).toBe(false);
  });

  it('is reported when the service can no longer be read', async () => {
    const { runs, goal, reads } = await setup('needs-sign-in');
    await runs.shape(goal);
    reads.succeeded += 1;
    expect(await runs.quiet(goal)).toBe(false);
  });

  it('is reported when a read failed, though the connection looks fine and another read worked', async () => {
    const { runs, goal, reads } = await setup();
    await runs.shape(goal);
    reads.failed += 1;
    reads.succeeded += 1;
    expect(await runs.quiet(goal)).toBe(false);
  });

  it('counts only what happened during the run, not what happened before it', async () => {
    const { runs, goal, reads } = await setup();
    reads.failed = 5;
    reads.succeeded = 5;
    await runs.shape(goal);
    reads.succeeded += 1;
    expect(await runs.quiet(goal)).toBe(true);
  });

  it('is reported when its connector is gone', async () => {
    const { runs, goal, book, mail, reads } = await setup();
    await book.remove(mail.id);
    const shape = await runs.shape(goal);
    expect(shape?.instructions).toContain('no longer exists');
    reads.succeeded += 1;
    expect(await runs.quiet(goal)).toBe(false);
  });
});
