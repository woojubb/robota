import { afterEach, describe, expect, it } from 'vitest';
import { clearRegisteredToolProfiles } from '@robota-sdk/agent-core';
import type { Roundtable } from '@robota-sdk/agent-roundtable';
import { World, type KillPlan } from './recovery-drill';
import {
  createIn,
  driveInterrupted,
  expectRecovered,
  InProcessStop,
  label,
  plansFor,
  reference,
  scenarios,
  type HostMode,
  type MatrixScenario,
  type Reference,
  type SettledEffect,
  type Stop,
} from './kill-matrix-harness';

afterEach(() => {
  clearRegisteredToolProfiles();
});

/**
 * The kill matrix's conversations, stopped without the process dying: a host cancelling, a run time
 * limit, a disposal, and a spent model-call allowance each interrupt the run at every write the
 * conversation commits and every entry the participant journals, and the host runs again. The
 * assertions are the kill matrix's: every effect the uninterrupted run completed ran exactly once, the
 * transcript is the uninterrupted one, and every reserved call was answered once.
 */
const reached = {
  cases: 0,
  /** Stops that ended a run, rather than landing between runs or after the last one. */
  endedARun: 0,
  parked: 0,
  refundedCalls: 0,
  retainedModelCalls: 0,
  retainedEffects: 0,
  /** Runs ended by a spent model-call allowance. */
  limited: 0,
};

async function endCase(world: World): Promise<void> {
  world.teardown();
  await new Promise((resolve) => setImmediate(resolve));
}

async function interrupted(
  scenario: MatrixScenario,
  ref: Reference,
  stop: InProcessStop,
  plan: KillPlan | undefined,
  mode: HostMode,
  extra: { maxModelCallsPerRun?: number } = {},
): Promise<{ stopped: number; settled: SettledEffect[] }> {
  const world = new World();
  const settled: SettledEffect[] = [];
  const restoreTimer = stop.hook();
  let room: Roundtable | undefined;
  try {
    const gen = world.generation(plan, stop.fire);
    room = createIn(scenario, gen, { ...stop.limits, ...extra });
    stop.attach(room);
    const out = await driveInterrupted(
      scenario,
      world,
      room,
      stop,
      mode,
      settled,
      (requests, before) => {
        // An effect that started without a result is not run again until the host settles it.
        for (const request of requests) {
          if (request.kind !== 'reconciliation') continue;
          const { effect } = (request.data as { parameters: { effect: string } }).parameters;
          expect(world.effects.get(effect) ?? 0).toBe(before[effect] ?? 0);
        }
      },
    );
    room = out.room;
    const counted = expectRecovered({ ref, world, room, result: out.result, settled });
    reached.cases++;
    if (out.stopped > 0) reached.endedARun++;
    reached.parked += counted.parked;
    reached.refundedCalls += counted.refundedCalls;
    reached.retainedModelCalls += counted.retainedModelCalls;
    reached.retainedEffects += counted.retainedEffects;
    return { stopped: out.stopped, settled };
  } finally {
    restoreTimer();
    await room?.dispose().catch(() => {});
    await endCase(world);
  }
}

const references = new Map<MatrixScenario, Reference>(
  await Promise.all(
    scenarios.map(async (scenario) => [scenario, await reference(scenario)] as const),
  ),
);

/** A stop is the same wherever a reply is lost or delivered, so only one of the two is swept. */
const points = (ref: Reference): KillPlan[] =>
  plansFor(ref).filter((plan) => plan.at === 'append' || !plan.replyLost);

const stops: Stop[] = ['cancel', 'time', 'dispose'];

describe.each(scenarios.map((scenario) => [scenario.name, scenario] as const))(
  'interruption matrix: %s',
  (_name, scenario) => {
    const ref = references.get(scenario)!;

    describe.each(stops)('%s', (kind) => {
      it.each(points(ref).map((plan) => [label(plan), plan] as const))(
        'continues to the same end when stopped %s',
        async (_label, plan) => {
          const { settled } = await interrupted(
            scenario,
            ref,
            new InProcessStop(kind),
            plan,
            'value',
          );
          // Where the host had to settle an effect, it can also say the effect failed.
          if (settled.length > 0)
            await interrupted(scenario, ref, new InProcessStop(kind), plan, 'failure');
        },
        120_000,
      );
    });

    const modelCalls = ref.completed.filter((call) => call.startsWith('model:')).length;
    it.each(Array.from({ length: Math.max(0, modelCalls - 1) }, (_, i) => i + 1))(
      'continues to the same end when each run may make only %i model call(s)',
      async (allowance) => {
        const { stopped } = await interrupted(
          scenario,
          ref,
          new InProcessStop('cancel'),
          undefined,
          'value',
          { maxModelCallsPerRun: allowance },
        );
        reached.limited += stopped;
      },
      120_000,
    );
  },
);

describe('interruption matrix: coverage', () => {
  it('reaches runs that were stopped, effects the host had to settle, and every kind of retained call', () => {
    expect(reached.cases).toBeGreaterThan(0);
    expect(reached.endedARun).toBeGreaterThan(0);
    expect(reached.parked).toBeGreaterThan(0);
    expect(reached.refundedCalls).toBeGreaterThan(0);
    expect(reached.retainedModelCalls).toBeGreaterThan(0);
    expect(reached.retainedEffects).toBeGreaterThan(0);
    expect(reached.limited).toBeGreaterThan(0);
  });
});
