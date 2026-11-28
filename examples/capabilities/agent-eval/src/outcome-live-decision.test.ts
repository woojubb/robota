import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BASELINE_SHARED_PASSES,
  decideTopology,
  totalRatio,
  type ICountedTrial,
  type TArm,
} from './outcome-live-decision.js';

const SHARED = ['t1', 't2', 't3', 't4', 't5'];
const ALL = [...SHARED, 'repo'];

interface IAmounts {
  readonly cost?: number;
  readonly wall?: number;
  readonly receiptless?: number;
}

/** `passes` of `counted` trials of an arm on a task, each with the given cost and wall time. */
function trials(
  arm: TArm,
  taskId: string,
  passes: number,
  counted = 3,
  amounts: IAmounts = {},
): ICountedTrial[] {
  return Array.from({ length: counted }, (_, index) => ({
    arm,
    taskId,
    passed: index < passes,
    costMicros: amounts.cost ?? 10,
    wallMs: amounts.wall ?? 100,
    callsWithoutReceipt: index === 0 ? (amounts.receiptless ?? 0) : 0,
  }));
}

/** Both arms over every task: `delegation[i]` and `control[i]` passes on the task at index i. */
function both(
  delegation: readonly number[],
  control: readonly number[],
  amounts: { delegation?: IAmounts; control?: IAmounts } = {},
): ICountedTrial[] {
  return ALL.flatMap((taskId, index) => [
    ...trials('delegation', taskId, delegation[index] ?? 0, 3, amounts.delegation),
    ...trials('control', taskId, control[index] ?? 0, 3, amounts.control),
  ]);
}

const decide = (list: readonly ICountedTrial[], withControl = true) =>
  decideTopology({ trials: list, taskIds: ALL, sharedTaskIds: SHARED, withControl });

test('with a control: a total gain of two, no task worse and both ratios at most three is justified', () => {
  const result = decide(both([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 2, 2]));
  assert.equal(result.outcome, 'justified');
  assert.equal(result.totalPassDifference, 2);
  assert.equal(result.costRatio?.value, 1);
  assert.equal(result.latencyRatio?.value, 1);
});

test('with a control: a ratio of exactly three is at most three', () => {
  const list = both([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 2, 2], {
    delegation: { cost: 30, wall: 300 },
    control: { cost: 10, wall: 100 },
  });
  const result = decide(list);
  assert.equal(result.costRatio?.value, 3);
  assert.equal(result.costRatio?.atMostThreshold, true);
  assert.equal(result.outcome, 'justified');
});

test('with a control: a ratio just above three is above, from the integers and not a rounded quotient', () => {
  assert.equal(totalRatio(31, 10, true).aboveThreshold, true);
  assert.equal(totalRatio(30, 10, true).aboveThreshold, false);
  assert.equal(totalRatio(30_000_001, 10_000_000, true).aboveThreshold, true);
  assert.equal(totalRatio(0, 10, true).value, 0);
  assert.equal(totalRatio(0, 10, true).atMostThreshold, true);
});

test('with a control: a zero or untrustworthy amount makes the ratio unknown, neither at most nor above', () => {
  for (const ratio of [totalRatio(5, 0, true), totalRatio(5, 10, false)]) {
    assert.equal(ratio.known, false);
    assert.equal(ratio.value, null);
    assert.equal(ratio.atMostThreshold, false);
    assert.equal(ratio.aboveThreshold, false);
  }
});

test('with a control: no total gain is not justified, a tie included, whatever the ratios', () => {
  assert.equal(decide(both([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 3, 3])).outcome, 'not-justified');
  assert.equal(decide(both([2, 3, 3, 3, 3, 3], [3, 3, 3, 3, 3, 3])).outcome, 'not-justified');
  const unknown = decide(
    both([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 3, 3], { delegation: { receiptless: 1 } }),
  );
  assert.equal(unknown.costRatio?.known, false);
  assert.equal(unknown.outcome, 'not-justified');
});

test('with a control: a task with a pass difference of zero is a tie and is not worse', () => {
  const result = decide(both([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 2, 2]));
  assert.equal(result.perTask.find((task) => task.taskId === 't1')?.worse, false);
  assert.equal(result.perTask.find((task) => task.taskId === 't1')?.passDifference, 0);
});

test('with a control: a gain of two or more with one task worse is inconclusive', () => {
  const worse = decide(both([3, 3, 3, 3, 3, 2], [0, 3, 3, 3, 3, 3]));
  assert.equal(worse.totalPassDifference, 2);
  assert.equal(worse.perTask.find((task) => task.taskId === 'repo')?.worse, true);
  assert.equal(worse.outcome, 'inconclusive');
  assert.match(worse.reasons.join(' '), /tasks worse: repo/);
});

test('with a control: a gain of two or more with a ratio above three is inconclusive, not not-justified', () => {
  const result = decide(
    both([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 2, 2], {
      delegation: { cost: 31 },
      control: { cost: 10 },
    }),
  );
  assert.equal(result.costRatio?.aboveThreshold, true);
  assert.equal(result.outcome, 'inconclusive');
});

test('with a control: a gain below two with a known ratio above three is not justified', () => {
  const cost = decide(
    both([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 3, 2], {
      delegation: { cost: 31 },
      control: { cost: 10 },
    }),
  );
  assert.equal(cost.totalPassDifference, 1);
  assert.equal(cost.outcome, 'not-justified');
  const latency = decide(
    both([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 3, 2], {
      delegation: { wall: 301 },
      control: { wall: 100 },
    }),
  );
  assert.equal(latency.outcome, 'not-justified');
  // One ratio above three is enough even when the other is unknown.
  const mixed = decide(
    both([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 3, 2], {
      delegation: { wall: 301, receiptless: 1 },
      control: { wall: 100 },
    }),
  );
  assert.equal(mixed.costRatio?.known, false);
  assert.equal(mixed.latencyRatio?.aboveThreshold, true);
  assert.equal(mixed.outcome, 'not-justified');
});

test('with a control: a gain of one with ratios in range is inconclusive', () => {
  const result = decide(both([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 3, 2]));
  assert.equal(result.outcome, 'inconclusive');
  assert.match(result.reasons.join(' '), /below 2/);
});

test('with a control: a call without a receipt makes the cost ratio unknown, in either arm', () => {
  for (const arm of ['delegation', 'control'] as const) {
    const result = decide(
      both([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 2, 2], { [arm]: { receiptless: 1 } }),
    );
    assert.equal(result.costRatio?.known, false);
    assert.equal(result.latencyRatio?.known, true);
    assert.equal(result.outcome, 'inconclusive');
    assert.match(result.reasons.join(' '), /settled-cost ratio is unknown/);
  }
});

test('with a control: a control cost or wall time of zero makes only that ratio unknown', () => {
  const zeroCost = decide(both([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 2, 2], { control: { cost: 0 } }));
  assert.equal(zeroCost.costRatio?.known, false);
  assert.equal(zeroCost.latencyRatio?.known, true);
  assert.equal(zeroCost.outcome, 'inconclusive');
  const zeroWall = decide(both([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 2, 2], { control: { wall: 0 } }));
  assert.equal(zeroWall.latencyRatio?.known, false);
  assert.equal(zeroWall.costRatio?.known, true);
  assert.equal(zeroWall.outcome, 'inconclusive');
});

test('with a control: a delegation cost of zero is a known ratio of zero and can be justified', () => {
  const result = decide(both([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 2, 2], { delegation: { cost: 0 } }));
  assert.equal(result.costRatio?.value, 0);
  assert.equal(result.outcome, 'justified');
});

test('with a control: fewer than three counted trials for any task and arm is inconclusive, over every other branch', () => {
  const list = both([3, 3, 3, 3, 3, 3], [0, 0, 0, 0, 0, 0]).filter(
    (trial) => !(trial.arm === 'control' && trial.taskId === 'repo'),
  );
  const missing = decide(list);
  assert.equal(missing.outcome, 'inconclusive');
  assert.deepEqual(missing.shortSlots, [{ arm: 'control', taskId: 'repo', counted: 0 }]);
  // The repository task counts here: it is in scope in the control form.
  const repoShort = decide(
    both([0, 0, 0, 0, 0, 0], [3, 3, 3, 3, 3, 3]).filter(
      (trial, index) => !(trial.arm === 'delegation' && trial.taskId === 'repo' && index % 2 === 0),
    ),
  );
  assert.ok(repoShort.shortSlots.some((slot) => slot.taskId === 'repo'));
  assert.equal(repoShort.outcome, 'inconclusive');
  const two = decide(
    both([3, 3, 3, 3, 3, 3], [3, 3, 3, 3, 3, 3]).filter(
      (trial, index) => !(trial.arm === 'delegation' && trial.taskId === 't1' && index % 3 === 2),
    ),
  );
  assert.ok(two.shortSlots.some((slot) => slot.arm === 'delegation' && slot.taskId === 't1'));
  assert.equal(two.outcome, 'inconclusive');
});

test('totals cover all six tasks, the repository task included', () => {
  const result = decide(both([0, 0, 0, 0, 0, 3], [0, 0, 0, 0, 0, 0]));
  assert.equal(result.totalPassDifference, 3);
  assert.equal(result.delegation.counted, 18);
  assert.equal(result.control?.counted, 18);
});

function alone(passesPerShared: number, repo = { passes: 3, counted: 3 }): ICountedTrial[] {
  return [
    ...SHARED.flatMap((taskId) => trials('delegation', taskId, passesPerShared)),
    ...trials('delegation', 'repo', repo.passes, repo.counted),
  ];
}

test('without a control: 15 of 15 on the shared tasks is capped at inconclusive', () => {
  const result = decide(alone(3), false);
  assert.equal(result.form, 'delegation-only');
  assert.equal(result.baseline?.delegationSharedPasses, BASELINE_SHARED_PASSES);
  assert.equal(result.outcome, 'inconclusive');
  assert.match(result.reasons.join(' '), /older revision/);
});

test('without a control: a single delegation failure on a shared task decides not justified', () => {
  const list = [
    ...SHARED.flatMap((taskId, index) => trials('delegation', taskId, index === 0 ? 2 : 3)),
    ...trials('delegation', 'repo', 3),
  ];
  const result = decide(list, false);
  assert.equal(result.baseline?.delegationSharedPasses, 14);
  assert.equal(result.outcome, 'not-justified');
});

test('without a control: the repository task is reported but never scored against the baseline', () => {
  const failing = decide(alone(3, { passes: 0, counted: 3 }), false);
  assert.equal(failing.outcome, 'inconclusive');
  const absent = decide(alone(3, { passes: 0, counted: 0 }), false);
  // Fewer than three counted trials on the repository task does not matter: it has no baseline.
  assert.equal(absent.outcome, 'inconclusive');
  assert.deepEqual(absent.shortSlots, []);
  assert.equal(absent.perTask.find((task) => task.taskId === 'repo')?.delegation.counted, 0);
  const worseAndAbsent = decide(
    [...SHARED.flatMap((taskId, index) => trials('delegation', taskId, index === 0 ? 0 : 3))],
    false,
  );
  assert.equal(worseAndAbsent.outcome, 'not-justified');
});

test('without a control: fewer than three counted trials on a shared task is inconclusive, over not justified', () => {
  const list = [
    ...SHARED.flatMap((taskId, index) =>
      index === 0 ? trials('delegation', taskId, 0, 2) : trials('delegation', taskId, 3),
    ),
  ];
  const result = decide(list, false);
  assert.deepEqual(result.shortSlots, [{ arm: 'delegation', taskId: 't1', counted: 2 }]);
  assert.equal(result.outcome, 'inconclusive');
});

test('without a control: control trials in the input are ignored by the delegation-only form', () => {
  const result = decide([...alone(3), ...trials('control', 't1', 0)], false);
  assert.equal(result.outcome, 'inconclusive');
  assert.equal(result.control, undefined);
});
