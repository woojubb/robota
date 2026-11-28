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
  twoKills: 0,
};

/** One restart, or a chain of them: each generation but the last is killed by its plan. */
async function recover(
  scenario: MatrixScenario,
  ref: Reference,
  plans: readonly KillPlan[],
  mode: HostMode,
): Promise<Recovered> {
  const world = new World();
  let gen = world.generation(plans[0]);
  let room = createIn(scenario, gen);
  let out = await drive(world, gen, room, mode);
  expect(out.killed).toBe(true);
  for (const plan of [...plans.slice(1), undefined]) {
    // What the dead process left of its effects is all a restart may count on.
    const before = Object.fromEntries(world.effects);
    gen = world.generation(plan);
    room = await loadIn(scenario, gen);
    out = await drive(world, gen, room, mode, (requests) => {
      // An effect that started without a result is never run again until the host settles it.
      for (const request of requests) {
        if (request.kind !== 'reconciliation') continue;
        const { effect } = (request.data as { parameters: { effect: string } }).parameters;
        expect(world.effects.get(effect) ?? 0).toBe(before[effect] ?? 0);
      }
    });
    // A second kill point past what recovery needs simply lets recovery finish.
    if (!out.killed) break;
  }
  if (out.killed) throw new Error('The final generation was killed');
  // Let the abandoned processes' leftovers be collected: a microtask-only chain never ends the job.
  await new Promise((resolve) => setImmediate(resolve));

  // Completed or not, the conversation ends as the uninterrupted one did.
  expect(out.result).toMatchObject({ status: 'completed', reason: 'done' });
  const view = room.snapshot();
  const failed = new Set(out.settled.filter((s) => s.answer === 'failure').map((s) => s.effect));
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
  expect(retained).toHaveLength(out.settled.length);
  const wanted = [...ref.completed];
  for (const call of completedCalls(view.usage)) {
    const at = wanted.indexOf(call);
    if (at >= 0) wanted.splice(at, 1);
  }
  expect(wanted).toEqual(out.settled.map(() => 'tool-effect:0/0'));
  for (const record of view.usage) {
    if (record.status !== 'settled') continue;
    if (record.outcome === 'not-dispatched') reached.refundedCalls++;
    else if (record.outcome !== 'completed')
      reached[record.kind === 'model' ? 'retainedModelCalls' : 'retainedEffects']++;
  }
  reached.parked += out.settled.length;
  if (plans.length > 1) reached.twoKills++;
  await room.dispose();
  return { settled: out.settled };
}

const references = new Map<MatrixScenario, Reference>(
  await Promise.all(
    scenarios.map(async (scenario) => [scenario, await reference(scenario)] as const),
  ),
);

/** Kill points of a recovery itself: what a restart writes and appends before it finishes. */
async function recoveryPoints(scenario: MatrixScenario, first: KillPlan): Promise<KillPlan[]> {
  const world = new World();
  const gen = world.generation(first);
  await drive(world, gen, createIn(scenario, gen), 'value');
  const probe = world.generation();
  await drive(world, probe, await loadIn(scenario, probe), 'value');
  return plansFor(probe);
}

/** First kills spread over the run, each landing at a different stage of the conversation. */
function firstKills(plans: readonly KillPlan[]): KillPlan[] {
  return [0.25, 0.5, 0.75].map((at) => plans[Math.floor(plans.length * at)]!);
}

/** Every pair of a first kill and a kill of the recovery that follows it. */
async function pairsFor(scenario: MatrixScenario, plans: readonly KillPlan[]) {
  const pairs: (readonly [KillPlan, KillPlan])[] = [];
  for (const first of firstKills(plans))
    for (const second of await recoveryPoints(scenario, first)) pairs.push([first, second]);
  return pairs;
}

const pairs = new Map<MatrixScenario, (readonly [KillPlan, KillPlan])[]>(
  await Promise.all(
    scenarios.map(
      async (scenario) =>
        [scenario, await pairsFor(scenario, plansFor(references.get(scenario)!))] as const,
    ),
  ),
);

async function both(scenario: MatrixScenario, ref: Reference, kills: readonly KillPlan[]) {
  const first = await recover(scenario, ref, kills, 'value');
  // Where the host had to settle an effect, it can also say the effect failed.
  if (first.settled.length > 0) await recover(scenario, ref, kills, 'failure');
}

describe.each(scenarios.map((scenario) => [scenario.name, scenario] as const))(
  'kill matrix: %s',
  (_name, scenario) => {
    const ref = references.get(scenario)!;
    const plans = plansFor(ref);

    it('has kill points to sweep', () => {
      expect(ref.writes).toBeGreaterThan(2);
      expect(ref.appends).toBeGreaterThan(2);
    });

    it.each(plans.map((plan) => [label(plan), plan] as const))(
      'recovers a process killed %s',
      async (_label, plan) => {
        await both(scenario, ref, [plan]);
      },
    );

    it.each(
      pairs
        .get(scenario)!
        .map((pair) => [`${label(pair[0])}, then ${label(pair[1])}`, pair] as const),
    )('recovers a process killed %s', async (_label, [first, second]) => {
      await both(scenario, ref, [first, second]);
    });
  },
);

describe('kill matrix: coverage', () => {
  it('reaches every recovery path the adapter classifies', () => {
    expect(reached.parked).toBeGreaterThan(0);
    expect(reached.refundedCalls).toBeGreaterThan(0);
    expect(reached.retainedModelCalls).toBeGreaterThan(0);
    expect(reached.retainedEffects).toBeGreaterThan(0);
    expect(reached.twoKills).toBeGreaterThan(0);
  });
});
