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

import { SYNC_OVERLAP_MINUTES, createSyncRuns } from '../connectors/sync-runs.js';

import type { ConnectorRegistry, IGoal, IGoalRun } from '@robota-sdk/agent-product/personal';
import type { ISyncProgressEntry, ISyncProgressStore } from '../connectors/sync-progress.js';

/** What runs confirmed, kept in memory. */
function memoryProgress(): ISyncProgressStore {
  const kept = new Map<string, ISyncProgressEntry[]>();
  return {
    list: (id) => kept.get(id) ?? [],
    record: (id, entry) => void kept.set(id, [...(kept.get(id) ?? []), entry]),
    forget: (id) => void kept.delete(id),
  };
}

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
  const progress = memoryProgress();
  const syncRuns = createSyncRuns({
    book,
    registry,
    goals,
    wiki,
    cases,
    progress,
    now: () => clock.now,
    ...(offers !== undefined && { offers }),
  });
  /** A run as the goal runner hands it over: the one that has just started. */
  const runFor = (found: IGoal): IGoalRun => ({
    id: 'run-under-test',
    goalId: found.id,
    startedAt: clock.now.toISOString(),
    actions: [],
  });
  return {
    reads,
    goals,
    book,
    wiki,
    cases,
    mail,
    goal,
    advance,
    progress,
    clock,
    runFor,
    runs: {
      shape: (found: IGoal, run: IGoalRun = runFor(found)) => syncRuns.shape(found, run),
      quiet: syncRuns.quiet,
    },
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

/** Run the progress tool a shaped run was given, as the model would. */
async function report(
  shape: Awaited<ReturnType<Awaited<ReturnType<typeof setup>>['runs']['shape']>>,
  args: Record<string, unknown>,
) {
  const tool = shape?.scopedTools?.find((entry) => entry.getName() === 'ConnectorSyncProgress');
  const { data } = await tool!.execute(
    args as never,
    {
      toolName: 'ConnectorSyncProgress',
      parameters: {},
    } as never,
  );
  return JSON.parse(String(data)) as { recorded: boolean; reason?: string };
}

const minutesBefore = (iso: string, minutes: number): string =>
  new Date(Date.parse(iso) - minutes * 60_000).toISOString();

describe('where a sync run starts reading when runs confirm what they read', () => {
  /** A run that ended well and reported once, as the host saw it. */
  async function confirmedRun(
    w: Awaited<ReturnType<typeof setup>>,
    entry: { through?: string; complete: boolean },
    outcome: 'done' | 'failed' | 'interrupted' = 'done',
  ) {
    const run = await w.goals.startRun(w.goal.id);
    w.progress.record(w.mail.id, { runId: run.id, ...entry, at: run.startedAt });
    w.advance(5);
    await w.goals.finishRun(run, outcome, outcome, { quiet: true });
    w.advance(55);
    return run;
  }

  it('starts a little before the point a run confirmed it reached, and reads oldest first from there', async () => {
    const w = await setup();
    const through = '2026-11-15T08:30:00.000Z';
    await confirmedRun(w, { through, complete: false });
    await w.goals.startRun(w.goal.id);
    const shape = await w.runs.shape((await w.goals.get(w.goal.id))!);
    const from = minutesBefore(through, SYNC_OVERLAP_MINUTES);
    expect(shape?.instructions).toContain(`received from ${from} on`);
    expect(shape?.instructions).toContain('oldest first');
    expect(shape?.onlyTools).toContain('ConnectorSyncProgress');
  });

  it('starts a little before where the run began when it confirmed it reached the end', async () => {
    const w = await setup();
    const run = await confirmedRun(w, { complete: true });
    await w.goals.startRun(w.goal.id);
    const shape = await w.runs.shape((await w.goals.get(w.goal.id))!);
    expect(shape?.instructions).toContain(
      `received from ${minutesBefore(run.startedAt, SYNC_OVERLAP_MINUTES)} on`,
    );
  });

  it('is not moved by a later run that ended well but confirmed nothing, nor by one that failed or was cut short', async () => {
    const w = await setup();
    const through = '2026-11-15T08:30:00.000Z';
    await confirmedRun(w, { through, complete: false });
    await runAs(w.goals, w.goal, 'done', w.advance);
    await confirmedRun(w, { through: '2026-11-15T09:00:00.000Z', complete: false }, 'failed');
    await confirmedRun(w, { complete: true }, 'interrupted');
    await w.goals.startRun(w.goal.id);
    const shape = await w.runs.shape((await w.goals.get(w.goal.id))!);
    expect(shape?.instructions).toContain(
      `received from ${minutesBefore(through, SYNC_OVERLAP_MINUTES)} on`,
    );
  });

  it('keeps the earlier rule for a connector no run has confirmed anything for yet', async () => {
    const w = await setup();
    const good = await runAs(w.goals, w.goal, 'done', w.advance);
    await w.goals.startRun(w.goal.id);
    const shape = await w.runs.shape((await w.goals.get(w.goal.id))!);
    expect(shape?.instructions).toContain(good.startedAt);
  });
});

describe('what a sync run may report about how far it read', () => {
  async function runningShape() {
    const w = await setup();
    const run = await w.goals.startRun(w.goal.id);
    const goal = (await w.goals.get(w.goal.id))!;
    const shape = await w.runs.shape(goal, run);
    return { w, run, shape };
  }

  it('is taken as the time through which it read, in UTC, and kept for this run only', async () => {
    const { w, run, shape } = await runningShape();
    const through = minutesBefore(w.clock.now.toISOString(), 30);
    expect(await report(shape, { connector: w.mail.id, through, complete: false })).toEqual({
      recorded: true,
    });
    expect(w.progress.list(w.mail.id)).toEqual([
      { runId: run.id, through, complete: false, at: w.clock.now.toISOString() },
    ]);
  });

  it('is taken as complete without a time, for a run that found nothing', async () => {
    const { w, run, shape } = await runningShape();
    expect(await report(shape, { connector: w.mail.id, complete: true })).toEqual({
      recorded: true,
    });
    expect(w.progress.list(w.mail.id)[0]).toMatchObject({ runId: run.id, complete: true });
  });

  it.each([
    ['a time that is not a time', (now: string) => ({ through: 'yesterday', now })],
    [
      'a time before the run’s own start',
      (now: string) => ({ through: minutesBefore(now, 9 * 24 * 60), now }),
    ],
    [
      'a time in the future',
      (now: string) => ({ through: new Date(Date.parse(now) + 60 * 60_000).toISOString(), now }),
    ],
  ])('is refused for %s, and nothing is kept', async (_name, make) => {
    const { w, shape } = await runningShape();
    const { through } = make(w.clock.now.toISOString());
    const answer = await report(shape, { connector: w.mail.id, through, complete: false });
    expect(answer.recorded).toBe(false);
    expect(answer.reason).toBeTruthy();
    expect(w.progress.list(w.mail.id)).toEqual([]);
  });

  it('is refused when it names no time and does not say it reached the end, or names another connector', async () => {
    const { w, shape } = await runningShape();
    expect((await report(shape, { connector: w.mail.id, complete: false })).recorded).toBe(false);
    expect((await report(shape, { connector: 'connector-other', complete: true })).recorded).toBe(
      false,
    );
    expect(w.progress.list(w.mail.id)).toEqual([]);
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
    expect(shape?.scopedTools?.map((tool) => tool.getName())).toEqual([
      'ConnectorSyncProgress',
      'TaskOfferPropose',
    ]);
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
    expect(plain?.scopedTools?.map((tool) => tool.getName())).toEqual(['ConnectorSyncProgress']);
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
