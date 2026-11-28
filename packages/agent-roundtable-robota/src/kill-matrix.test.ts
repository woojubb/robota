import { afterEach, describe, expect, it } from 'vitest';
import { clearRegisteredToolProfiles } from '@robota-sdk/agent-core';
import { World, type KillPlan } from './recovery-drill';
import {
  completedCalls,
  createIn,
  drive,
  label,
  loadIn,
  plansFor,
  reference,
  transcript,
  type HostMode,
  type MatrixScenario,
  type SettledEffect,
  type Reference,
} from './kill-matrix-harness';

afterEach(() => {
  clearRegisteredToolProfiles();
});

const scenarios: MatrixScenario[] = [
  { name: 'a plain text turn', members: ['solo'], turns: 1, effectsOf: () => 0 },
  { name: 'a turn with one paid effect', members: ['solo'], turns: 1, effectsOf: () => 1 },
  {
    name: 'a turn with two paid effects in sequence',
    members: ['solo'],
    turns: 1,
    effectsOf: () => 2,
  },
  {
    name: 'a conversation of two members',
    members: ['alice', 'bob'],
    turns: 3,
    effectsOf: (id) => (id === 'alice' ? 1 : 0),
  },
  {
    name: 'a turn that parks an approval wait and continues it',
    members: ['solo'],
    turns: 1,
    effectsOf: () => 1,
    approval: true,
  },
];

interface Recovered {
  /** Effects the host had to settle, by how. */
  settled: { effect: string; answer: 'value' | 'failure' }[];
}

/** What the sweep actually exercised, so a matrix that stops reaching a recovery path says so. */
const reached = {
  parked: 0,
  refundedCalls: 0,
  retainedModelCalls: 0,
  retainedEffects: 0,
  /** A recovery was killed after it had killed once before. */
  twoKills: 0,
  /** The host settled a parked effect and the process died before the participant journaled it. */
  settledThenKilled: 0,
};

/** One restart, or a chain of them: each generation but the last is killed by its plan. */
async function recover(
  scenario: MatrixScenario,
  ref: Reference,
  plans: readonly KillPlan[],
  mode: HostMode,
): Promise<Recovered> {
  const world = new World();
  // Everything the host settled, in every generation, killed or not.
  const settled: SettledEffect[] = [];
  let gen = world.generation(plans[0]);
  let room = createIn(scenario, gen);
  let out = await drive(world, gen, room, mode, settled);
  expect(out.killed).toBe(true);
  if (settled.length > 0) reached.settledThenKilled++;
  for (const plan of [...plans.slice(1), undefined]) {
    // What the dead process left of its effects is all a restart may count on.
    const before = Object.fromEntries(world.effects);
    gen = world.generation(plan);
    room = await loadIn(scenario, gen);
    const settledBefore = settled.length;
    out = await drive(world, gen, room, mode, settled, (requests) => {
      // An effect that started without a result is never run again until the host settles it.
      for (const request of requests) {
        if (request.kind !== 'reconciliation') continue;
        const { effect } = (request.data as { parameters: { effect: string } }).parameters;
        expect(world.effects.get(effect) ?? 0).toBe(before[effect] ?? 0);
      }
    });
    // A second kill point past what recovery needs simply lets recovery finish.
    if (!out.killed) break;
    reached.twoKills++;
    if (settled.length > settledBefore) reached.settledThenKilled++;
  }
  if (out.killed) throw new Error('The final generation was killed');
  // Let the abandoned processes' leftovers be collected: a microtask-only chain never ends the job.
  await new Promise((resolve) => setImmediate(resolve));

  // Completed or not, the conversation ends as the uninterrupted one did.
  expect(out.result).toMatchObject({ status: 'completed', reason: 'done' });
  const view = room.snapshot();
  const failed = new Set(settled.filter((s) => s.answer === 'failure').map((s) => s.effect));
  const expectedEffects = Object.fromEntries(
    Object.entries(ref.effects).filter(([effect]) => !failed.has(effect)),
  );
  // Every effect ran at most once, and every effect the reference completed ran exactly once.
  for (const count of world.effects.values()) expect(count).toBe(1);
  expect(Object.fromEntries(world.effects)).toEqual(expectedEffects);
  // The transcript is the uninterrupted one, except where the host said an effect failed.
  const expected = ref.messages.map(([who, text]) => [
    who,
    [...failed].reduce(
      (said, effect) => said.replace(`paid:${effect}`, `declined:${effect}`),
      text!,
    ),
  ]);
  expect(transcript(room)).toEqual(expected);
  expect(view.requests).toEqual([]);

  // Every reserved call ends settled, refunded or retained; each is answered once, under its own id.
  expect(new Set(view.usage.map((record) => record.callId)).size).toBe(view.usage.length);
  for (const record of view.usage) {
    expect(record.status).toBe('settled');
    if (record.status === 'settled' && record.outcome === 'not-dispatched')
      expect(record.tokens).toBeUndefined();
  }
  // The ledger holds every call the reference completed, except an effect the host had to settle:
  // its consumption is the host's to say, so that call stays retained at its bound.
  const retained = view.usage.filter(
    (record) =>
      record.kind === 'tool-effect' &&
      record.status === 'settled' &&
      record.outcome !== 'completed' &&
      record.outcome !== 'not-dispatched',
  );
  expect(retained).toHaveLength(settled.length);
  const wanted = [...ref.completed];
  for (const call of completedCalls(view.usage)) {
    const at = wanted.indexOf(call);
    if (at >= 0) wanted.splice(at, 1);
  }
  expect(wanted).toEqual(settled.map(() => 'tool-effect:0/0'));
  for (const record of view.usage) {
    if (record.status !== 'settled') continue;
    if (record.outcome === 'not-dispatched') reached.refundedCalls++;
    else if (record.outcome !== 'completed')
      reached[record.kind === 'model' ? 'retainedModelCalls' : 'retainedEffects']++;
  }
  reached.parked += settled.length;
  await room.dispose();
  return { settled };
}

const references = new Map<MatrixScenario, Reference>(
  await Promise.all(
    scenarios.map(async (scenario) => [scenario, await reference(scenario)] as const),
  ),
);

/**
 * The full first x second product is behind `KILL_MATRIX_FULL=1`. Each recovery leaves a little
 * memory behind, so the full product needs a larger worker heap: `VITEST_WORKER_HEAP_MB=6144`.
 *
 * CI sweeps the recoveries of two kinds of first kill: three sampled ones spread over the run (every
 * other kill point of their recovery, plus the early ones below), and every first kill whose recovery parks an effect that the host then settles. For the second kind the
 * second kill is taken at the recovery's first few writes and appends, where it reconciles, takes the
 * host's answer and hands it to the participant: a kill there leaves the host's answer committed
 * while the participant has not yet journaled it.
 */
const FULL = process.env.KILL_MATRIX_FULL === '1';
const EARLY_WRITES = 3;
const EARLY_APPENDS = 2;

/** The kill points of a recovery itself: what a restart writes and appends before it finishes. */
async function recoveryPoints(
  scenario: MatrixScenario,
  first: KillPlan,
  mode: HostMode,
): Promise<KillPlan[]> {
  const world = new World();
  const gen = world.generation(first);
  await drive(world, gen, createIn(scenario, gen), mode, []);
  const restart = world.generation();
  await drive(world, restart, await loadIn(scenario, restart), mode, []);
  return plansFor(restart);
}

/** First kills spread over the run, each landing at a different stage of the conversation. */
function sampledFirstKills(plans: readonly KillPlan[]): Set<KillPlan> {
  return new Set([0.25, 0.5, 0.75].map((at) => plans[Math.floor(plans.length * at)]!));
}

const early = (plan: KillPlan): boolean =>
  plan.at === 'commit' ? plan.n < EARLY_WRITES : plan.k < EARLY_APPENDS;

/** Kills the recovery of one first kill at each of its own points, under one host answer. */
async function sweepSecondKills(
  scenario: MatrixScenario,
  ref: Reference,
  first: KillPlan,
  mode: HostMode,
  breadth: 'all' | 'alternate' | 'early',
): Promise<void> {
  const points = await recoveryPoints(scenario, first, mode);
  for (const [index, second] of points.entries()) {
    const wanted =
      breadth === 'all' || early(second) || (breadth === 'alternate' && index % 2 === 0);
    if (wanted) await recover(scenario, ref, [first, second], mode);
  }
}

describe.each(scenarios.map((scenario) => [scenario.name, scenario] as const))(
  'kill matrix: %s',
  (_name, scenario) => {
    const ref = references.get(scenario)!;
    const plans = plansFor(ref);
    const sampled = sampledFirstKills(plans);

    it('has kill points to sweep', () => {
      expect(ref.writes).toBeGreaterThan(2);
      expect(ref.appends).toBeGreaterThan(2);
    });

    it.each(plans.map((plan) => [label(plan), plan] as const))(
      'recovers a process killed %s, and the recovery killed again',
      async (_label, plan) => {
        const value = await recover(scenario, ref, [plan], 'value');
        // Where the host had to settle an effect, it can also say the effect failed.
        const settles = value.settled.length > 0;
        if (settles) await recover(scenario, ref, [plan], 'failure');
        if (!FULL && !settles && !sampled.has(plan)) return;
        const breadth = FULL ? 'all' : sampled.has(plan) ? 'alternate' : 'early';
        await sweepSecondKills(scenario, ref, plan, 'value', breadth);
        // What the failure answer writes can differ from a value's, so its kill points are its own.
        if (settles) await sweepSecondKills(scenario, ref, plan, 'failure', breadth);
      },
      FULL ? 900_000 : 120_000,
    );
  },
);

describe('kill matrix: coverage', () => {
  it('reaches every recovery path the adapter classifies, and their combinations', () => {
    expect(reached.parked).toBeGreaterThan(0);
    expect(reached.refundedCalls).toBeGreaterThan(0);
    expect(reached.retainedModelCalls).toBeGreaterThan(0);
    expect(reached.retainedEffects).toBeGreaterThan(0);
    expect(reached.twoKills).toBeGreaterThan(0);
    expect(reached.settledThenKilled).toBeGreaterThan(0);
  });
});
