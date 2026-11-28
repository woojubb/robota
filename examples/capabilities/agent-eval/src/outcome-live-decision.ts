/**
 * The topology decision rule, as posted before the first paid call. Pure: its only inputs are the
 * counted trials (verdict from the environment verifier, settled cost from the receipts, wall time
 * from the written observation), so nothing an agent or a reviewer claims can move the outcome.
 *
 * Two forms. With a single-agent control arm at equal per-trial caps, the outcome compares the two
 * arms: pass difference per task and in total, settled-cost ratio and wall-latency ratio (the
 * thresholds use the total ratios). Without a control arm, delegation alone is compared with the
 * pinned baseline's measured passes on the five shared tasks; the baseline ran on an older
 * revision, so the outcome is capped at inconclusive unless delegation falls short of it.
 */

export type TArm = 'delegation' | 'control';
export type TTopologyOutcome = 'justified' | 'not-justified' | 'inconclusive';

/** Counted trials a task and arm needs before the outcome can be anything but inconclusive. */
export const COUNTED_TRIALS_PER_TASK = 3;
/** Measured passes the pinned single-agent baseline recorded on the five shared tasks. */
export const BASELINE_SHARED_PASSES = 15;
/** A total ratio above this is too expensive or too slow. */
export const MAX_TOTAL_RATIO = 3;
/** The total pass gain a "justified" outcome needs. */
export const MIN_TOTAL_GAIN = 2;

/** A trial that counts: a pass, or a failed attempt that stays in the denominator. */
export interface ICountedTrial {
  readonly arm: TArm;
  readonly taskId: string;
  readonly passed: boolean;
  /** Sum of the receipt costs of the trial's calls, in micro-dollars. */
  readonly costMicros: number;
  /** Wall time from trial start to the written observation. */
  readonly wallMs: number;
  /** Calls admitted whose settlement carries no receipt. */
  readonly callsWithoutReceipt: number;
}

export interface IDecisionInput {
  readonly trials: readonly ICountedTrial[];
  /** Every task of the comparison (the five shared tasks and the repository task). */
  readonly taskIds: readonly string[];
  /** The tasks the pinned baseline also ran. */
  readonly sharedTaskIds: readonly string[];
  readonly withControl: boolean;
}

export interface IArmTaskResult {
  readonly counted: number;
  readonly passes: number;
  readonly costMicros: number;
  readonly wallMs: number;
}

export interface ITaskDecision {
  readonly taskId: string;
  readonly delegation: IArmTaskResult;
  readonly control?: IArmTaskResult;
  /** Delegation passes minus control passes. */
  readonly passDifference?: number;
  /** The pass difference is below zero (zero is a tie). */
  readonly worse?: boolean;
}

export interface IArmTotals {
  readonly counted: number;
  readonly passes: number;
  readonly costMicros: number;
  readonly wallMs: number;
  readonly callsWithoutReceipt: number;
}

/** A total ratio delegation / control; `value` is null when it is unknown. */
export interface IRatio {
  readonly value: number | null;
  readonly known: boolean;
  /** Known and at most the threshold. */
  readonly atMostThreshold: boolean;
  /** Known and above the threshold. */
  readonly aboveThreshold: boolean;
}

export interface IDecision {
  readonly form: 'with-control' | 'delegation-only';
  readonly outcome: TTopologyOutcome;
  /** Why the outcome is what it is, in rule order. */
  readonly reasons: readonly string[];
  readonly perTask: readonly ITaskDecision[];
  readonly delegation: IArmTotals;
  readonly control?: IArmTotals;
  /** Task and arm pairs that have fewer than the required counted trials (the rule's scope only). */
  readonly shortSlots: readonly {
    readonly arm: TArm;
    readonly taskId: string;
    readonly counted: number;
  }[];
  readonly totalPassDifference?: number;
  readonly costRatio?: IRatio;
  readonly latencyRatio?: IRatio;
  /** Delegation alone: the shared-task comparison with the pinned baseline. */
  readonly baseline?: {
    readonly baselineSharedPasses: number;
    readonly delegationSharedPasses: number;
    readonly delegationSharedCounted: number;
  };
}

function armTaskResult(
  trials: readonly ICountedTrial[],
  arm: TArm,
  taskId: string,
): IArmTaskResult {
  let counted = 0;
  let passes = 0;
  let costMicros = 0;
  let wallMs = 0;
  for (const trial of trials) {
    if (trial.arm !== arm || trial.taskId !== taskId) continue;
    counted += 1;
    if (trial.passed) passes += 1;
    costMicros += trial.costMicros;
    wallMs += trial.wallMs;
  }
  return { counted, passes, costMicros, wallMs };
}

function armTotals(
  trials: readonly ICountedTrial[],
  arm: TArm,
  taskIds: readonly string[],
): IArmTotals {
  const scope = new Set(taskIds);
  let counted = 0;
  let passes = 0;
  let costMicros = 0;
  let wallMs = 0;
  let callsWithoutReceipt = 0;
  for (const trial of trials) {
    if (trial.arm !== arm || !scope.has(trial.taskId)) continue;
    counted += 1;
    if (trial.passed) passes += 1;
    costMicros += trial.costMicros;
    wallMs += trial.wallMs;
    callsWithoutReceipt += trial.callsWithoutReceipt;
  }
  return { counted, passes, costMicros, wallMs, callsWithoutReceipt };
}

const UNKNOWN: IRatio = {
  value: null,
  known: false,
  atMostThreshold: false,
  aboveThreshold: false,
};

/**
 * Delegation / control, unknown when the control's amount is zero or the amounts are not
 * trustworthy. The thresholds are compared on the integers, never on a rounded quotient. An unknown
 * ratio is neither "at most" nor "above" the threshold. A delegation amount of zero is a ratio of 0.
 */
export function totalRatio(delegation: number, control: number, trustworthy: boolean): IRatio {
  if (!trustworthy || control === 0) return UNKNOWN;
  return {
    value: delegation / control,
    known: true,
    atMostThreshold: delegation <= MAX_TOTAL_RATIO * control,
    aboveThreshold: delegation > MAX_TOTAL_RATIO * control,
  };
}

/** Task and arm pairs short of the required counted trials, over the tasks and arms in scope. */
function shortSlotsOf(
  trials: readonly ICountedTrial[],
  arms: readonly TArm[],
  taskIds: readonly string[],
): IDecision['shortSlots'] {
  const short: { arm: TArm; taskId: string; counted: number }[] = [];
  for (const arm of arms) {
    for (const taskId of taskIds) {
      const { counted } = armTaskResult(trials, arm, taskId);
      if (counted < COUNTED_TRIALS_PER_TASK) short.push({ arm, taskId, counted });
    }
  }
  return short;
}

function describeShort(short: IDecision['shortSlots']): string {
  return `fewer than ${COUNTED_TRIALS_PER_TASK} counted trials: ${short
    .map((slot) => `${slot.arm}/${slot.taskId} has ${slot.counted}`)
    .join(', ')}`;
}

function decideWithControl(input: IDecisionInput): IDecision {
  const { trials, taskIds } = input;
  const perTask: ITaskDecision[] = taskIds.map((taskId) => {
    const delegation = armTaskResult(trials, 'delegation', taskId);
    const control = armTaskResult(trials, 'control', taskId);
    const passDifference = delegation.passes - control.passes;
    return { taskId, delegation, control, passDifference, worse: passDifference < 0 };
  });
  const delegation = armTotals(trials, 'delegation', taskIds);
  const control = armTotals(trials, 'control', taskIds);
  const totalPassDifference = delegation.passes - control.passes;
  // A call without a receipt leaves the settled cost unknown; a zero control amount cannot divide.
  const receiptsKnown = delegation.callsWithoutReceipt === 0 && control.callsWithoutReceipt === 0;
  const costRatio = totalRatio(delegation.costMicros, control.costMicros, receiptsKnown);
  const latencyRatio = totalRatio(delegation.wallMs, control.wallMs, true);
  const shortSlots = shortSlotsOf(trials, ['delegation', 'control'], taskIds);
  const base = {
    form: 'with-control' as const,
    perTask,
    delegation,
    control,
    shortSlots,
    totalPassDifference,
    costRatio,
    latencyRatio,
  };
  if (shortSlots.length > 0) {
    return { ...base, outcome: 'inconclusive', reasons: [describeShort(shortSlots)] };
  }
  const noTotalGain = totalPassDifference <= 0;
  const gainBelowMinimum = totalPassDifference < MIN_TOTAL_GAIN;
  const aRatioAbove = costRatio.aboveThreshold || latencyRatio.aboveThreshold;
  if (noTotalGain) {
    return {
      ...base,
      outcome: 'not-justified',
      reasons: [`no total gain (pass difference ${totalPassDifference})`],
    };
  }
  if (aRatioAbove && gainBelowMinimum) {
    return {
      ...base,
      outcome: 'not-justified',
      reasons: [
        `a known total ratio above ${MAX_TOTAL_RATIO} with a total gain of ${totalPassDifference}, below ${MIN_TOTAL_GAIN}`,
      ],
    };
  }
  const worseTasks = perTask.filter((task) => task.worse).map((task) => task.taskId);
  if (
    totalPassDifference >= MIN_TOTAL_GAIN &&
    worseTasks.length === 0 &&
    costRatio.atMostThreshold &&
    latencyRatio.atMostThreshold
  ) {
    return {
      ...base,
      outcome: 'justified',
      reasons: [
        `total gain of ${totalPassDifference}, no task worse, both total ratios known and at most ${MAX_TOTAL_RATIO}`,
      ],
    };
  }
  const reasons: string[] = [];
  if (gainBelowMinimum)
    reasons.push(`total gain of ${totalPassDifference} is below ${MIN_TOTAL_GAIN}`);
  if (worseTasks.length > 0) reasons.push(`tasks worse: ${worseTasks.join(', ')}`);
  if (!costRatio.known) reasons.push('the settled-cost ratio is unknown');
  if (!latencyRatio.known) reasons.push('the wall-latency ratio is unknown');
  if (costRatio.aboveThreshold) reasons.push(`the settled-cost ratio is above ${MAX_TOTAL_RATIO}`);
  if (latencyRatio.aboveThreshold)
    reasons.push(`the wall-latency ratio is above ${MAX_TOTAL_RATIO}`);
  return { ...base, outcome: 'inconclusive', reasons };
}

function decideDelegationOnly(input: IDecisionInput): IDecision {
  const { trials, taskIds, sharedTaskIds } = input;
  const perTask: ITaskDecision[] = taskIds.map((taskId) => ({
    taskId,
    delegation: armTaskResult(trials, 'delegation', taskId),
  }));
  const delegation = armTotals(trials, 'delegation', taskIds);
  const shared = armTotals(trials, 'delegation', sharedTaskIds);
  // Only the five shared tasks are in scope: the repository task has no baseline.
  const shortSlots = shortSlotsOf(trials, ['delegation'], sharedTaskIds);
  const base = {
    form: 'delegation-only' as const,
    perTask,
    delegation,
    shortSlots,
    baseline: {
      baselineSharedPasses: BASELINE_SHARED_PASSES,
      delegationSharedPasses: shared.passes,
      delegationSharedCounted: shared.counted,
    },
  };
  if (shortSlots.length > 0) {
    return { ...base, outcome: 'inconclusive', reasons: [describeShort(shortSlots)] };
  }
  if (shared.passes < BASELINE_SHARED_PASSES) {
    return {
      ...base,
      outcome: 'not-justified',
      reasons: [
        `delegation passed ${shared.passes} of ${shared.counted} on the shared tasks, below the baseline's ${BASELINE_SHARED_PASSES}`,
      ],
    };
  }
  return {
    ...base,
    outcome: 'inconclusive',
    reasons: [
      'the baseline ran on an older revision, so the outcome without a control arm is capped at inconclusive',
    ],
  };
}

/** Applies the posted rule to the counted trials. */
export function decideTopology(input: IDecisionInput): IDecision {
  return input.withControl ? decideWithControl(input) : decideDelegationOnly(input);
}
