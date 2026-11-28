import { describe, expect, it } from 'vitest';
import {
  createIn,
  finish,
  finishingSelector,
  loadIn,
  runUntilKilled,
  World,
  type KillPlan,
  type Scenario,
} from './durable-harness';
import type { RunResult } from './types';

const sequential: Scenario = {
  conversationId: 'room',
  agents: ['alice', 'bob'],
  selector: finishingSelector(4, (turns) => ({
    kind: 'speak',
    participantId: turns % 2 === 0 ? 'alice' : 'bob',
  })),
};

const parallel: Scenario = {
  conversationId: 'room',
  agents: ['alice', 'bob'],
  concurrency: 2,
  selector: finishingSelector(4, () => ({ kind: 'parallel', participantIds: ['alice', 'bob'] })),
};

// Bob fails on his second turn, after his model call and before his effect.
const failing: Scenario = {
  ...sequential,
  failure: (participantId, seen) =>
    participantId === 'bob' && (seen[0] ?? '').startsWith('alice replies to bob'),
};

interface Reference {
  writes: number;
  appends: number;
  messages: string[][];
  terminal: string;
  effects: Record<string, number>;
}

function terminalOf(result: RunResult): string {
  if (result.status === 'completed') return `completed:${result.reason}`;
  if (result.status === 'failed') return `failed:${result.message}`;
  return result.status;
}

async function reference(scenario: Scenario): Promise<Reference> {
  const world = new World();
  const gen = world.generation();
  const room = createIn(scenario, gen);
  const out = await runUntilKilled(gen, room);
  if (out.killed) throw new Error('The uninterrupted run was killed');
  if (out.result.status !== 'completed' && out.result.status !== 'failed')
    throw new Error(`The uninterrupted run ended ${out.result.status}`);
  return {
    writes: gen.writes,
    appends: gen.appends,
    messages: room.snapshot().messages.map((m) => [m.participantId, m.content]),
    terminal: terminalOf(out.result),
    effects: Object.fromEntries(world.effects),
  };
}

function plansFor(ref: Reference): KillPlan[] {
  const plans: KillPlan[] = [];
  for (let n = 0; n < ref.writes; n++)
    for (const replyLost of [false, true]) plans.push({ at: 'commit', n, replyLost });
  for (let k = 0; k < ref.appends; k++)
    for (const written of [false, true]) plans.push({ at: 'append', k, written });
  return plans;
}

const label = (plan: KillPlan) =>
  plan.at === 'commit'
    ? `after commit ${plan.n}, reply ${plan.replyLost ? 'lost' : 'delivered'}`
    : `at append ${plan.k}, ${plan.written ? 'written' : 'not written'}`;

/** One restart, or a chain of them: each generation but the last is killed by its plan. */
async function recover(
  scenario: Scenario,
  ref: Reference,
  plans: readonly KillPlan[],
): Promise<void> {
  const world = new World();
  let gen = world.generation(plans[0]);
  let room = createIn(scenario, gen);
  let out = await runUntilKilled(gen, room);
  expect(out.killed).toBe(true);
  for (const plan of [...plans.slice(1), undefined]) {
    gen = world.generation(plan);
    room = await loadIn(scenario, gen);
    out = await runUntilKilled(gen, room);
    // A second kill point past what recovery needs simply lets recovery finish.
    if (!out.killed) break;
  }
  if (out.killed) throw new Error('The final generation was killed');
  const result = await finish(world, room, out.result);
  // Let the abandoned process's leftovers be collected: a microtask-only chain never ends the job.
  await new Promise((resolve) => setImmediate(resolve));
  const view = room.snapshot();
  // Every completed effect ran exactly once, and the transcript is the uninterrupted one.
  expect(Object.fromEntries(world.effects)).toEqual(ref.effects);
  expect(view.messages.map((m) => [m.participantId, m.content])).toEqual(ref.messages);
  expect(terminalOf(result)).toBe(ref.terminal);
  expect(view.requests).toEqual([]);
  // Every call ends settled: reported, refunded exactly, or retained at its bound as unknown.
  for (const record of view.usage) {
    expect(record.status).toBe('settled');
    if (record.status === 'settled' && record.outcome === 'not-dispatched')
      expect(record.tokens).toBeUndefined();
  }
}

const references = new Map<Scenario, Reference>(
  await Promise.all(
    [sequential, parallel, failing].map(
      async (scenario) => [scenario, await reference(scenario)] as const,
    ),
  ),
);

describe.each([
  ['sequential', sequential],
  ['parallel group', parallel],
  ['failing member', failing],
])('kill matrix: %s', (_name, scenario) => {
  const ref = references.get(scenario)!;
  const plans = plansFor(ref);

  it('has kill points to sweep', () => {
    expect(ref.writes).toBeGreaterThan(5);
    expect(ref.appends).toBeGreaterThan(3);
  });

  it.each(plans.map((plan) => [label(plan), plan] as const))(
    'recovers a process killed %s',
    async (_label, plan) => {
      await recover(scenario, ref, [plan]);
    },
  );
});

describe('kill matrix: a second process killed during recovery', () => {
  const ref = references.get(sequential)!;
  const first = plansFor(ref).filter((plan) => plan.at === 'commit' && plan.replyLost);

  it.each(first.map((plan) => [label(plan), plan] as const))(
    'recovers twice after a first kill %s',
    async (_label, plan) => {
      // Count what recovery itself writes, then kill it at each of its writes and appends.
      const world = new World();
      const gen = world.generation(plan);
      await runUntilKilled(gen, createIn(sequential, gen));
      const probe = world.generation();
      const room = await loadIn(sequential, probe);
      await runUntilKilled(probe, room);
      const second: KillPlan[] = [];
      // The first writes of a recovery are the ones that settle what the first process left.
      for (let n = 0; n < Math.min(probe.writes, 3); n++)
        for (const replyLost of [false, true]) second.push({ at: 'commit', n, replyLost });
      for (let k = 0; k < Math.min(probe.appends, 2); k++)
        second.push({ at: 'append', k, written: k % 2 === 0 });
      for (const killSecond of second) await recover(sequential, ref, [plan, killSecond]);
    },
  );
});
