/**
 * How a sync run is told where to start and when it is worth reporting, with the goal book and the
 * library in memory and a service whose state a test sets.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  CaseBook,
  ConnectorBook,
  GoalBook,
  KnowledgeWiki,
  createMemoryCaseStore,
  createMemoryConnectorStore,
  createMemoryGoalStore,
  createMemoryKnowledgeStore,
  createOfferTools,
  syncRunTools,
} from '@robota-sdk/agent-product/personal';

import { createSyncRuns } from '../connectors/sync-runs.js';

import type { ConnectorRegistry, IGoal } from '@robota-sdk/agent-product/personal';

async function setup(
  state: 'connected' | 'needs-sign-in' = 'connected',
  offers?: Parameters<typeof createSyncRuns>[0]['offers'],
) {
  const clock = { now: new Date('2026-11-15T10:00:00.000Z') };
  const goals = new GoalBook({ store: createMemoryGoalStore(), now: () => clock.now });
  const book = new ConnectorBook({ store: createMemoryConnectorStore() });
  const wiki = new KnowledgeWiki({ store: createMemoryKnowledgeStore() });
  const cases = new CaseBook({ store: createMemoryCaseStore(), feed: goals });
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
    cases,
    mail,
    goal,
    advance,
    runs: createSyncRuns({
      book,
      registry,
      goals,
      wiki,
      cases,
      ...(offers !== undefined && { offers }),
    }),
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

describe('what a sync run is given to propose offers', () => {
  const proposing = () => {
    const tool = createOfferTools({ propose: async () => ({ status: 'rejected', reason: 'x' }) });
    return {
      runTools: vi.fn(() => tool),
      instructions: vi.fn(async () => 'Task offers: propose only the tasks listed here.'),
    };
  };

  it('is told about the offers after the sync’s own words, and given the run’s own tool, the one it was already allowed', async () => {
    const offers = proposing();
    const { runs, goal } = await setup('connected', offers);
    const shape = await runs.shape(goal);
    expect(shape?.instructions).toContain('first sync');
    expect(shape?.instructions.endsWith('Task offers: propose only the tasks listed here.')).toBe(
      true,
    );
    expect(shape?.onlyTools).toEqual(syncRunTools());
    expect(shape?.scopedTools?.map((tool) => tool.getName())).toEqual(['TaskOfferPropose']);
    expect(shape?.onlyTools).toContain('TaskOfferPropose');
  });

  it('asks for the run’s own tool anew for each run, so one run’s count is not another’s', async () => {
    const offers = proposing();
    const { runs, goal } = await setup('connected', offers);
    await runs.shape(goal);
    await runs.shape(goal);
    expect(offers.runTools).toHaveBeenCalledTimes(2);
  });

  it('is given nothing more when the host has no offers, and for a connector that is gone', async () => {
    const without = await setup('connected');
    const plain = await without.runs.shape(without.goal);
    expect(plain?.scopedTools).toBeUndefined();
    expect(plain?.instructions).not.toContain('Task offers');

    const offers = proposing();
    const gone = await setup('connected', offers);
    await gone.book.remove(gone.mail.id);
    const shape = await gone.runs.shape(gone.goal);
    expect(shape?.scopedTools).toBeUndefined();
    expect(shape?.instructions).toContain('no longer exists');
    expect(offers.runTools).not.toHaveBeenCalled();
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

  it('is quiet when it opened a case and added nothing else: the question card is the message', async () => {
    const { runs, goal, cases, mail, reads } = await setup();
    await runs.shape(goal);
    reads.succeeded += 1;
    await cases.open({
      title: 'New sign-in',
      noticed: 'A mail says a new sign-in happened at 10:02.',
      source: 'mail:message-1',
      connectorId: mail.id,
    });
    expect(await runs.quiet(goal)).toBe(true);
  });

  it('is quiet when it opened a case although no read was counted, since the case is the message', async () => {
    const { runs, goal, cases, mail } = await setup();
    await runs.shape(goal);
    await cases.open({
      title: 'New sign-in',
      noticed: 'A mail says a new sign-in happened at 10:02.',
      source: 'mail:message-1',
      connectorId: mail.id,
    });
    expect(await runs.quiet(goal)).toBe(true);
  });

  it('is reported when it opened a case and also added something to the library', async () => {
    const { runs, goal, cases, wiki, mail, reads } = await setup();
    await runs.shape(goal);
    reads.succeeded += 1;
    await cases.open({
      title: 'New sign-in',
      noticed: 'A mail says a new sign-in happened at 10:02.',
      source: 'mail:message-1',
      connectorId: mail.id,
    });
    await wiki.remember({
      pageTitle: 'Mina',
      claim: 'Dinner on Friday',
      source: { origin: 'mail', reference: `connector:${mail.id} Plans` },
    });
    expect(await runs.quiet(goal)).toBe(false);
  });

  it('is reported when it opened a case but a read failed, or the connection is gone', async () => {
    const failing = await setup();
    await failing.runs.shape(failing.goal);
    failing.reads.failed += 1;
    failing.reads.succeeded += 1;
    await failing.cases.open({
      title: 'New sign-in',
      noticed: 'A mail says a new sign-in happened at 10:02.',
      source: 'mail:message-1',
      connectorId: failing.mail.id,
    });
    expect(await failing.runs.quiet(failing.goal)).toBe(false);

    const gone = await setup('needs-sign-in');
    await gone.runs.shape(gone.goal);
    gone.reads.succeeded += 1;
    await gone.cases.open({
      title: 'New sign-in',
      noticed: 'A mail says a new sign-in happened at 10:02.',
      source: 'mail:message-1',
      connectorId: gone.mail.id,
    });
    expect(await gone.runs.quiet(gone.goal)).toBe(false);
  });

  it('counts only the cases this run opened, from this connector', async () => {
    const { runs, goal, cases, mail } = await setup();
    // A case from before the run, and one that came from somewhere else, are not this run's doing.
    await cases.open({
      title: 'Earlier',
      noticed: 'Seen before.',
      source: 'mail:old',
      connectorId: mail.id,
    });
    await runs.shape(goal);
    await cases.open({
      title: 'Elsewhere',
      noticed: 'From another service.',
      source: 'chat:1',
      connectorId: 'connector-other',
    });
    await cases.open({
      title: 'A thought of its own',
      noticed: 'Not from any connector.',
      source: 'own:1',
    });
    expect(await runs.quiet(goal)).toBe(false);
  });

  it('does not take a case that already existed for the same item as one it opened', async () => {
    const { runs, goal, cases, mail } = await setup();
    const item = {
      title: 'New sign-in',
      noticed: 'A mail says a new sign-in happened at 10:02.',
      source: 'mail:message-1',
      connectorId: mail.id,
    };
    await cases.open(item);
    await runs.shape(goal);
    // Asking again for the same item gets the old case back, so nothing was opened, and a run that
    // read nothing and opened nothing is reported.
    expect((await cases.open(item)).existing).toBe(true);
    expect(await runs.quiet(goal)).toBe(false);
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
