import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DriverConfigError } from './outcome-live-driver.js';
import { parseDriverFlags } from './outcome-live-flags.js';
import {
  armOrder,
  classifyTrial,
  danglingStarts,
  nextTrial,
  planSlots,
  slotKey,
  summarizeRun,
  trialIdOf,
  type ISlot,
  type ITrialEnd,
  type TDriverEvent,
} from './outcome-live-plan.js';

const TASKS = ['a', 'b', 'c', 'd', 'e', 'f'];

test('the plan: one smoke trial per arm, then three rounds of six tasks with both arms', () => {
  const slots = planSlots({
    arms: ['delegation', 'control'],
    taskIds: TASKS,
    trialsPerTask: 3,
    smokeTaskId: 'a',
  });
  assert.equal(slots.length, 2 + 3 * 6 * 2);
  assert.deepEqual(
    slots.slice(0, 2).map((slot) => [slot.kind, slot.arm]),
    [
      ['smoke', 'delegation'],
      ['smoke', 'control'],
    ],
  );
  const counted = slots.filter((slot) => slot.kind === 'counted');
  for (const arm of ['delegation', 'control']) {
    assert.equal(counted.filter((slot) => slot.arm === arm).length, 18);
    // 19 trials per arm with the smoke trial, as the plan's arithmetic says.
    assert.equal(slots.filter((slot) => slot.arm === arm).length, 19);
  }
  assert.equal(new Set(slots.map(slotKey)).size, slots.length);
});

test('the plan: arms alternate by task and by round, so no arm always goes first', () => {
  const slots = planSlots({
    arms: ['delegation', 'control'],
    taskIds: TASKS,
    trialsPerTask: 3,
    smokeTaskId: 'a',
  });
  const firstArm = (round: number, taskId: string): string =>
    (
      slots.find(
        (slot) => slot.kind === 'counted' && slot.round === round && slot.taskId === taskId,
      ) as ISlot
    ).arm;
  // Within a round the first arm alternates from one task to the next.
  assert.deepEqual(
    TASKS.map((task) => firstArm(1, task)),
    ['control', 'delegation', 'control', 'delegation', 'control', 'delegation'],
  );
  // For one task it alternates from one round to the next.
  for (const task of TASKS) {
    const order = [1, 2, 3].map((round) => firstArm(round, task));
    assert.notEqual(order[0], order[1]);
    assert.notEqual(order[1], order[2]);
  }
  // The pair of one task and round is adjacent (interleaved), never spread out.
  const keys = slots.map(slotKey);
  for (const round of [1, 2, 3]) {
    const a = keys.indexOf(`counted.delegation.a.${round}`);
    const b = keys.indexOf(`counted.control.a.${round}`);
    assert.equal(Math.abs(a - b), 1);
  }
});

test('the plan: delegation alone has no control slot', () => {
  const slots = planSlots({
    arms: ['delegation'],
    taskIds: TASKS,
    trialsPerTask: 3,
    smokeTaskId: 'a',
  });
  assert.equal(slots.length, 1 + 18);
  assert.ok(slots.every((slot) => slot.arm === 'delegation'));
  assert.deepEqual(armOrder(['delegation'], 1, 1), ['delegation']);
});

function end(
  slot: ISlot,
  attempt: number,
  outcome: ITrialEnd['outcome'],
  patch: Partial<ITrialEnd> = {},
): ITrialEnd {
  return {
    type: 'trial-end',
    trialId: trialIdOf(slot, attempt),
    slotKey: slotKey(slot),
    kind: slot.kind,
    arm: slot.arm,
    taskId: slot.taskId,
    round: slot.round,
    attempt,
    outcome,
    failures: outcome === 'fail' ? ['verifier-failed'] : [],
    costMicros: 1_000,
    callsAdmitted: 2,
    callsWithoutReceipt: 0,
    wallMs: 500,
    upstreamAttempts: 2,
    capReached: false,
    ledger: {
      callsAdmitted: 0,
      remainingCalls: 0,
      committedMicros: 0,
      settledMicros: 0,
      reservedMicros: 0,
      unsettledIds: [],
      stopReason: undefined,
    },
    ...patch,
  };
}

const SLOTS = planSlots({
  arms: ['delegation', 'control'],
  taskIds: ['a', 'b'],
  trialsPerTask: 3,
  smokeTaskId: 'a',
});

test('the next trial is the first slot without a finished trial; a pass or a failure closes a slot', () => {
  assert.deepEqual(nextTrial(SLOTS, []), { slot: SLOTS[0], attempt: 1 });
  const events: TDriverEvent[] = [
    end(SLOTS[0] as ISlot, 1, 'pass'),
    end(SLOTS[1] as ISlot, 1, 'fail'),
  ];
  assert.deepEqual(nextTrial(SLOTS, events), { slot: SLOTS[2], attempt: 1 });
});

test('an infrastructure stop does not close its slot: one recovery trial takes the same place', () => {
  const events: TDriverEvent[] = [
    end(SLOTS[0] as ISlot, 1, 'pass'),
    end(SLOTS[1] as ISlot, 1, 'pass'),
    end(SLOTS[2] as ISlot, 1, 'infra-stop', { stopKind: 'spend-gate' }),
  ];
  assert.deepEqual(nextTrial(SLOTS, events), { slot: SLOTS[2], attempt: 2 });
  events.push(end(SLOTS[2] as ISlot, 2, 'infra-stop', { stopKind: 'container-error' }));
  assert.deepEqual(nextTrial(SLOTS, events), { slot: SLOTS[2], attempt: 3 });
  events.push(end(SLOTS[2] as ISlot, 3, 'pass'));
  assert.deepEqual(nextTrial(SLOTS, events), { slot: SLOTS[3], attempt: 1 });
  assert.equal(
    nextTrial(
      SLOTS,
      SLOTS.map((slot) => end(slot, 1, 'pass')),
    ),
    undefined,
  );
});

test('a trial that started and never ended is found', () => {
  const slot = SLOTS[0] as ISlot;
  const events: TDriverEvent[] = [
    {
      type: 'trial-start',
      trialId: trialIdOf(slot, 1),
      slotKey: slotKey(slot),
      attempt: 1,
      at: 'x',
    },
    {
      type: 'trial-start',
      trialId: trialIdOf(slot, 2),
      slotKey: slotKey(slot),
      attempt: 2,
      at: 'x',
    },
    end(slot, 2, 'pass'),
  ];
  assert.deepEqual(
    danglingStarts(events).map((start) => start.trialId),
    [trialIdOf(slot, 1)],
  );
});

const passingRecord = { score: { passed: true, failures: [] }, capReached: false } as const;

test('classification: a pass and an ordinary failure are counted, with no stop', () => {
  assert.deepEqual(classifyTrial({ record: passingRecord, admissionRefusals: [] }), {
    outcome: 'pass',
  });
  for (const failure of [
    'verifier-failed',
    'call-cap',
    'not-delegated',
    'not-completed',
    'interrupted',
  ]) {
    const verdict = classifyTrial({
      record: { score: { passed: false, failures: [failure] }, capReached: failure === 'call-cap' },
      admissionRefusals: [],
    });
    assert.deepEqual(verdict, { outcome: 'fail' }, failure);
  }
});

test('classification: a container or verifier error before an observation is an infrastructure stop', () => {
  const verdict = classifyTrial({ thrown: 'docker said no', admissionRefusals: [] });
  assert.equal(verdict.outcome, 'infra-stop');
  assert.equal(verdict.stopKind, 'container-error');
  assert.equal(verdict.halt, 'container-error');
});

test('classification: a spend-gate stop is an infrastructure stop that halts the run', () => {
  for (const reason of [
    'call 1 got no answer',
    'call 2 has no usable receipt',
    'call 3: the provider differs from the pinned route',
    'call 4: the model differs from the pinned route',
    'call 5: the output tokens are missing or exceed the output cap',
    'call 6: the cost exceeds the reservation',
  ]) {
    const verdict = classifyTrial({
      record: {
        score: { passed: false, failures: ['run-stopped'] },
        capReached: false,
        stopReason: reason,
      },
      admissionRefusals: [],
    });
    assert.equal(verdict.outcome, 'infra-stop', reason);
    assert.equal(verdict.stopKind, 'spend-gate');
    assert.equal(verdict.halt, 'spend-gate');
  }
});

test('classification: an unattributed call is the agent’s failure, counted, and still halts the run', () => {
  const verdict = classifyTrial({
    record: {
      score: { passed: false, failures: ['run-stopped'] },
      capReached: false,
      stopReason: 'unattributed call: no role marker',
    },
    admissionRefusals: [],
  });
  assert.equal(verdict.outcome, 'fail');
  assert.equal(verdict.halt, 'unattributed');
  assert.equal(verdict.stopKind, undefined);
});

test('classification: a refused admission is a counted failure that halts the run', () => {
  const verdict = classifyTrial({
    record: { score: { passed: false, failures: ['not-completed'] }, capReached: false },
    admissionRefusals: ['cap: the call cap is reached'],
  });
  assert.equal(verdict.outcome, 'fail');
  assert.equal(verdict.halt, 'admission-refused');
});

test('classification: a refused admission halts the run without changing a trial that passed', () => {
  const verdict = classifyTrial({
    record: { score: { passed: true, failures: [] }, capReached: false },
    admissionRefusals: ['cap: the call cap is reached'],
  });
  assert.equal(verdict.outcome, 'pass');
  assert.equal(verdict.halt, 'admission-refused');
});

test('the summary counts finished trials only and keeps smoke and infrastructure stops apart', () => {
  const smoke = SLOTS[0] as ISlot;
  const counted = SLOTS[2] as ISlot;
  const events: TDriverEvent[] = [
    end(smoke, 1, 'pass'),
    end(counted, 1, 'infra-stop', {
      stopKind: 'spend-gate',
      stopReason: 'x',
      callsWithoutReceipt: 1,
    }),
    end(counted, 2, 'fail'),
  ];
  const summary = summarizeRun({
    arms: ['delegation', 'control'],
    taskIds: ['a', 'b'],
    sharedTaskIds: ['a', 'b'],
    slots: SLOTS,
    events,
  });
  const arm = counted.arm;
  assert.equal(summary.arms[arm]?.counted, 1);
  assert.equal(summary.arms[arm]?.passes, 0);
  assert.equal(summary.arms[arm]?.failureCounts['verifier-failed'], 1);
  assert.equal(summary.uncounted.smoke.length, 1);
  assert.equal(summary.uncounted.infrastructureStops.length, 1);
  assert.equal(summary.uncounted.infrastructureStops[0]?.recoveryTrialId, trialIdOf(counted, 2));
  assert.equal(summary.finished, false);
  assert.equal(summary.slotsClosed, 2);
  assert.equal(summary.outcome, 'inconclusive');
});

test('flags: a complete real-run command line becomes a configuration', () => {
  const { config, build } = parseDriverFlags(
    [
      '--arms',
      'delegation,control',
      '--trial-cap',
      '20',
      '--call-cap',
      '800',
      '--ceiling-usd',
      '2',
      '--evidence',
      '/somewhere/evidence',
      '--credential-file',
      '/somewhere/credentials',
      '--credential-name',
      'GATEWAY_KEY',
      '--decision-rule',
      'https://example.test/x#issuecomment-1',
      '--model',
      'model-id',
      '--endpoint',
      'https://gateway.example/v1/chat/completions',
      '--provider',
      'route-a',
      '--route-options',
      '{"provider":{"only":["route-a"]}}',
    ],
    '/repo',
  );
  assert.deepEqual(config.arms, ['delegation', 'control']);
  assert.equal(config.trialCap, 20);
  assert.equal(config.callCap, 800);
  assert.equal(config.ceilingMicros, 2_000_000);
  assert.equal(config.dryRun, false);
  assert.equal(config.resume, false);
  assert.deepEqual(config.routeOptions, { provider: { only: ['route-a'] } });
  assert.equal(build.source, '/repo');
});

test('flags: the ceiling rounds down, never up', () => {
  const { config } = parseDriverFlags(
    [
      '--arms',
      'delegation',
      '--trial-cap',
      '1',
      '--call-cap',
      '1',
      '--ceiling-usd',
      '1.9999999',
      '--evidence',
      '/e',
      '--dry-run',
    ],
    '/repo',
  );
  assert.equal(config.ceilingMicros, 1_999_999);
});

test('flags: refused when something is missing or malformed', () => {
  const base = [
    '--arms',
    'delegation',
    '--trial-cap',
    '5',
    '--call-cap',
    '10',
    '--ceiling-usd',
    '2',
    '--evidence',
    '/e',
    '--dry-run',
  ];
  assert.doesNotThrow(() => parseDriverFlags(base, '/repo'));
  const without = (flag: string): string[] => {
    const at = base.indexOf(flag);
    return [...base.slice(0, at), ...base.slice(at + 2)];
  };
  for (const flag of ['--arms', '--trial-cap', '--call-cap', '--ceiling-usd', '--evidence']) {
    assert.throws(() => parseDriverFlags(without(flag), '/repo'), DriverConfigError, flag);
  }
  const patched = (flag: string, value: string): string[] =>
    base.map((item, index) => (base[index - 1] === flag ? value : item));
  assert.throws(
    () => parseDriverFlags(patched('--arms', 'delegation,other'), '/repo'),
    DriverConfigError,
  );
  assert.throws(() => parseDriverFlags(patched('--trial-cap', '0'), '/repo'), DriverConfigError);
  assert.throws(() => parseDriverFlags(patched('--trial-cap', '2.5'), '/repo'), DriverConfigError);
  assert.throws(
    () => parseDriverFlags(patched('--ceiling-usd', 'free'), '/repo'),
    DriverConfigError,
  );
  assert.throws(
    () => parseDriverFlags([...base, '--route-options', '[1]'], '/repo'),
    DriverConfigError,
  );
  assert.throws(
    () => parseDriverFlags([...base, '--basis-prompt-usd-per-million', '1'], '/repo'),
    DriverConfigError,
  );
});

test('flags: a real run names the model, endpoint and provider; a dry run needs none of them', () => {
  const real = [
    '--arms',
    'delegation',
    '--trial-cap',
    '5',
    '--call-cap',
    '10',
    '--ceiling-usd',
    '2',
    '--evidence',
    '/e',
  ];
  for (const missing of [
    [],
    ['--model', 'm'],
    ['--model', 'm', '--endpoint', 'https://g/v1/chat/completions'],
  ]) {
    assert.throws(() => parseDriverFlags([...real, ...missing], '/repo'), DriverConfigError);
  }
  const dry = parseDriverFlags([...real, '--dry-run'], '/repo');
  assert.equal(dry.config.dryRun, true);
  assert.equal(dry.config.model, 'dry-run-model');
});
