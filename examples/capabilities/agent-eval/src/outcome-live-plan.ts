import type { ILedgerState } from './outcome-coding-ledger.js';
import type { ITrialRecord } from './outcome-coding-trial.js';
import type { IRoleMeasure, ITrialMeasures } from './outcome-delegation-measures.js';
import {
  decideTopology,
  type ICountedTrial,
  type IDecision,
  type TArm,
} from './outcome-live-decision.js';

/**
 * The order of a paid run and what each finished trial means, as pure functions of the events the
 * driver appends to the evidence folder. Resuming rebuilds everything from those events, so the
 * next trial and the summary never depend on what one process remembers.
 *
 * Order: one smoke trial per arm, then the counted trials in rounds. Within a round the tasks go in
 * their fixed order, and the arm that goes first alternates by task and round, so neither arm
 * always runs first or always meets the same task first.
 */

export type TTrialKind = 'smoke' | 'counted';

export interface ISlot {
  readonly kind: TTrialKind;
  readonly arm: TArm;
  readonly taskId: string;
  /** 0 for a smoke trial, 1 to the number of rounds otherwise. */
  readonly round: number;
}

export const slotKey = (slot: ISlot): string =>
  `${slot.kind}.${slot.arm}.${slot.taskId}.${slot.round}`;

export interface IPlanInput {
  readonly arms: readonly TArm[];
  /** The tasks in their fixed order. */
  readonly taskIds: readonly string[];
  readonly trialsPerTask: number;
  /** The task a smoke trial runs on. */
  readonly smokeTaskId: string;
}

/** The arm order of one task in one round: delegation first on even sums, control first on odd. */
export function armOrder(arms: readonly TArm[], taskIndex: number, round: number): readonly TArm[] {
  const ordered: TArm[] = (['delegation', 'control'] as const).filter((arm) => arms.includes(arm));
  return (taskIndex + round) % 2 === 0 ? ordered : [...ordered].reverse();
}

export function planSlots(input: IPlanInput): ISlot[] {
  const slots: ISlot[] = [];
  for (const arm of armOrder(input.arms, 0, 0)) {
    slots.push({ kind: 'smoke', arm, taskId: input.smokeTaskId, round: 0 });
  }
  for (let round = 1; round <= input.trialsPerTask; round += 1) {
    input.taskIds.forEach((taskId, taskIndex) => {
      for (const arm of armOrder(input.arms, taskIndex, round)) {
        slots.push({ kind: 'counted', arm, taskId, round });
      }
    });
  }
  return slots;
}

/** Why a trial that ended is an infrastructure stop. */
export type TStopKind = 'spend-gate' | 'container-error' | 'interrupted';

/** Why the driver stopped and went no further. */
export type THaltKind =
  | 'preflight'
  | 'spend-gate'
  | 'container-error'
  | 'unattributed'
  | 'admission-refused'
  | 'credits'
  | 'catalog'
  | 'leak'
  | 'internal';

export type TTrialOutcome = 'pass' | 'fail' | 'infra-stop';

export interface ITrialEnd {
  readonly type: 'trial-end';
  readonly trialId: string;
  readonly slotKey: string;
  readonly kind: TTrialKind;
  readonly arm: TArm;
  readonly taskId: string;
  readonly round: number;
  readonly attempt: number;
  readonly outcome: TTrialOutcome;
  readonly failures: readonly string[];
  readonly stopKind?: TStopKind;
  readonly stopReason?: string;
  /** Sum of the receipt costs of the trial's calls, in micro-dollars. */
  readonly costMicros: number;
  readonly callsAdmitted: number;
  readonly callsWithoutReceipt: number;
  readonly wallMs: number;
  readonly upstreamAttempts: number;
  readonly capReached: boolean;
  readonly measures?: ITrialMeasures;
  readonly diagnostics?: readonly string[];
  readonly error?: string;
  readonly cleanupError?: string;
  readonly ledger: ILedgerState;
}

export interface ITrialStart {
  readonly type: 'trial-start';
  readonly trialId: string;
  readonly slotKey: string;
  readonly attempt: number;
  readonly at: string;
}

export interface IHalt {
  readonly type: 'halt';
  readonly kind: THaltKind;
  readonly reason: string;
  /** The ledger when the stop happened; absent before a ledger exists. */
  readonly ledger?: ILedgerState;
  readonly trialId?: string;
}

export type TDriverEvent =
  | ITrialStart
  | ITrialEnd
  | IHalt
  | { readonly type: 'note'; readonly note: string; readonly [key: string]: unknown };

export const trialIdOf = (slot: ISlot, attempt: number): string =>
  `${slotKey(slot).replaceAll('.', '-')}-a${attempt}`;

const FINISHED: ReadonlySet<TTrialOutcome> = new Set(['pass', 'fail']);

export interface INextTrial {
  readonly slot: ISlot;
  /** 1 for the first run of a slot, 2 for the recovery of one infrastructure stop, and so on. */
  readonly attempt: number;
}

/**
 * The first slot with no finished trial, and the attempt number it gets: one more than the
 * infrastructure stops it already has. A finished trial (pass or fail) closes its slot; an
 * infrastructure stop does not, so the recovery trial takes the same place in the order.
 */
export function nextTrial(
  slots: readonly ISlot[],
  events: readonly TDriverEvent[],
): INextTrial | undefined {
  const ends = events.filter((event): event is ITrialEnd => event.type === 'trial-end');
  for (const slot of slots) {
    const key = slotKey(slot);
    const own = ends.filter((end) => end.slotKey === key);
    if (own.some((end) => FINISHED.has(end.outcome))) continue;
    return { slot, attempt: own.length + 1 };
  }
  return undefined;
}

/** Trials that were started and never ended: a process that died in the middle of them. */
export function danglingStarts(events: readonly TDriverEvent[]): ITrialStart[] {
  const ended = new Set(
    events.filter((event): event is ITrialEnd => event.type === 'trial-end').map((e) => e.trialId),
  );
  return events.filter(
    (event): event is ITrialStart => event.type === 'trial-start' && !ended.has(event.trialId),
  );
}

/** What a trial that just ended meant for the run. */
export interface ITrialClassification {
  readonly outcome: TTrialOutcome;
  readonly stopKind?: TStopKind;
  /** When set, the run stops here with no retry; `--resume` is the only way on. */
  readonly halt?: THaltKind;
  readonly reason?: string;
}

export interface IClassifyInput {
  /** The trial threw before its observation was written (a container or verifier error). */
  readonly thrown?: string;
  readonly record?: Pick<ITrialRecord, 'score' | 'stopReason' | 'capReached'>;
  /** Details of the admissions the ledger refused during the trial. */
  readonly admissionRefusals: readonly string[];
}

const UNATTRIBUTED = /^unattributed call/;

/**
 * The posted rule. An infrastructure stop is a spend-gate stop (no answer or receipt, a provider or
 * model mismatch, an output or cost overrun) or a container or verifier error before an observation
 * was written; it is replaced by one recovery trial. Every other non-pass is a failed attempt in
 * the denominator: the call cap, no delegation, an unattributed call, a deadline, a wrong tree. A
 * stop of either kind, and a refused admission, also ends the run, with no retry in this process.
 */
export function classifyTrial(input: IClassifyInput): ITrialClassification {
  if (input.thrown !== undefined) {
    return {
      outcome: 'infra-stop',
      stopKind: 'container-error',
      halt: 'container-error',
      reason: input.thrown,
    };
  }
  const record = input.record;
  if (record === undefined) {
    return { outcome: 'infra-stop', stopKind: 'interrupted', halt: 'container-error' };
  }
  if (record.stopReason !== undefined) {
    if (UNATTRIBUTED.test(record.stopReason)) {
      return { outcome: 'fail', halt: 'unattributed', reason: record.stopReason };
    }
    return {
      outcome: 'infra-stop',
      stopKind: 'spend-gate',
      halt: 'spend-gate',
      reason: record.stopReason,
    };
  }
  if (input.admissionRefusals.length > 0) {
    // The verdict stays the environment's: a refused admission ends the run, not the trial's result.
    return {
      outcome: record.score.passed ? 'pass' : 'fail',
      halt: 'admission-refused',
      reason: input.admissionRefusals[0] as string,
    };
  }
  return { outcome: record.score.passed ? 'pass' : 'fail' };
}

/** The counted trials in the form the decision rule takes. */
export function countedTrials(events: readonly TDriverEvent[]): ICountedTrial[] {
  return events
    .filter(
      (event): event is ITrialEnd =>
        event.type === 'trial-end' && event.kind === 'counted' && FINISHED.has(event.outcome),
    )
    .map((end) => ({
      arm: end.arm,
      taskId: end.taskId,
      passed: end.outcome === 'pass',
      costMicros: end.costMicros,
      wallMs: end.wallMs,
      callsWithoutReceipt: end.callsWithoutReceipt,
    }));
}

type TRoleTotals = Record<string, IRoleMeasure>;

function addMeasure(into: IRoleMeasure | undefined, from: IRoleMeasure): IRoleMeasure {
  const base = into ?? {
    calls: 0,
    refusedCalls: 0,
    failedCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    tokenUnknownCalls: 0,
    latencyMs: 0,
  };
  return {
    calls: base.calls + from.calls,
    refusedCalls: base.refusedCalls + from.refusedCalls,
    failedCalls: base.failedCalls + from.failedCalls,
    promptTokens: base.promptTokens + from.promptTokens,
    completionTokens: base.completionTokens + from.completionTokens,
    tokenUnknownCalls: base.tokenUnknownCalls + from.tokenUnknownCalls,
    latencyMs: base.latencyMs + from.latencyMs,
  };
}

export interface IArmSummary {
  readonly counted: number;
  readonly passes: number;
  readonly failureCounts: Readonly<Record<string, number>>;
  /** Settled cost over the counted trials, in micro-dollars; calls without a receipt are in `unknownCostTrials`. */
  readonly settledCostMicros: number;
  readonly unknownCostTrials: number;
  readonly wallMs: number;
  readonly byRole: Readonly<TRoleTotals>;
  readonly coordination: {
    readonly calls: number;
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly latencyMs: number;
    readonly idleBetweenJobsMs: number;
  };
}

function summarizeArm(ends: readonly ITrialEnd[]): IArmSummary {
  const failureCounts: Record<string, number> = {};
  const byRole: TRoleTotals = {};
  let settledCostMicros = 0;
  let unknownCostTrials = 0;
  let wallMs = 0;
  let passes = 0;
  const coordination = {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    latencyMs: 0,
    idleBetweenJobsMs: 0,
  };
  for (const end of ends) {
    if (end.outcome === 'pass') passes += 1;
    for (const failure of end.failures) failureCounts[failure] = (failureCounts[failure] ?? 0) + 1;
    settledCostMicros += end.costMicros;
    if (end.callsWithoutReceipt > 0) unknownCostTrials += 1;
    wallMs += end.wallMs;
    for (const [role, measure] of Object.entries(end.measures?.byRole ?? {})) {
      byRole[role] = addMeasure(byRole[role], measure);
    }
    const c = end.measures?.coordination;
    if (c !== undefined) {
      coordination.calls += c.calls;
      coordination.promptTokens += c.promptTokens;
      coordination.completionTokens += c.completionTokens;
      coordination.latencyMs += c.latencyMs;
      coordination.idleBetweenJobsMs += c.idleBetweenJobsMs ?? 0;
    }
  }
  return {
    counted: ends.length,
    passes,
    failureCounts,
    settledCostMicros,
    unknownCostTrials,
    wallMs,
    byRole,
    coordination,
  };
}

export interface IRunSummary {
  readonly schema: 1;
  readonly finished: boolean;
  readonly slotsTotal: number;
  readonly slotsClosed: number;
  readonly outcome: IDecision['outcome'];
  readonly decision: IDecision;
  readonly arms: Readonly<Record<string, IArmSummary>>;
  readonly byTask: Readonly<Record<string, Readonly<Record<string, IArmSummary>>>>;
  /** Smoke and infrastructure-stop trials: spent, reported, never counted. */
  readonly uncounted: {
    readonly smoke: readonly ISmokeSummary[];
    readonly infrastructureStops: readonly IStopSummary[];
    readonly byArm: Readonly<Record<string, IArmSummary>>;
  };
  readonly halts: readonly IHalt[];
}

export interface ISmokeSummary {
  readonly trialId: string;
  readonly arm: TArm;
  readonly taskId: string;
  readonly outcome: TTrialOutcome;
  readonly failures: readonly string[];
  readonly costMicros: number;
  readonly callsAdmitted: number;
}

export interface IStopSummary {
  readonly trialId: string;
  readonly kind: TTrialKind;
  readonly arm: TArm;
  readonly taskId: string;
  readonly stopKind: TStopKind | undefined;
  readonly reason: string | undefined;
  readonly costMicros: number;
  readonly callsAdmitted: number;
  /** The recovery trial that replaced it, once it has run. */
  readonly recoveryTrialId: string | undefined;
}

export interface ISummaryInput {
  readonly arms: readonly TArm[];
  readonly taskIds: readonly string[];
  readonly sharedTaskIds: readonly string[];
  readonly slots: readonly ISlot[];
  readonly events: readonly TDriverEvent[];
}

/** Everything the report needs that comes from the trial events; the driver adds ledger, preflight and cleanup. */
export function summarizeRun(input: ISummaryInput): IRunSummary {
  const ends = input.events.filter((event): event is ITrialEnd => event.type === 'trial-end');
  const counted = ends.filter((end) => end.kind === 'counted' && FINISHED.has(end.outcome));
  const decision = decideTopology({
    trials: countedTrials(input.events),
    taskIds: input.taskIds,
    sharedTaskIds: input.sharedTaskIds,
    withControl: input.arms.includes('control'),
  });
  const arms: Record<string, IArmSummary> = {};
  const byTask: Record<string, Record<string, IArmSummary>> = {};
  const uncountedByArm: Record<string, IArmSummary> = {};
  const uncounted = ends.filter((end) => !(end.kind === 'counted' && FINISHED.has(end.outcome)));
  for (const arm of input.arms) {
    arms[arm] = summarizeArm(counted.filter((end) => end.arm === arm));
    uncountedByArm[arm] = summarizeArm(uncounted.filter((end) => end.arm === arm));
    byTask[arm] = {};
    for (const taskId of input.taskIds) {
      (byTask[arm] as Record<string, IArmSummary>)[taskId] = summarizeArm(
        counted.filter((end) => end.arm === arm && end.taskId === taskId),
      );
    }
  }
  const stops = ends.filter((end) => end.outcome === 'infra-stop');
  const infrastructureStops: IStopSummary[] = stops.map((stop) => {
    const later = ends.find(
      (end) => end.slotKey === stop.slotKey && end.attempt === stop.attempt + 1,
    );
    return {
      trialId: stop.trialId,
      kind: stop.kind,
      arm: stop.arm,
      taskId: stop.taskId,
      stopKind: stop.stopKind,
      reason: stop.stopReason ?? stop.error,
      costMicros: stop.costMicros,
      callsAdmitted: stop.callsAdmitted,
      recoveryTrialId: later?.trialId,
    };
  });
  const smoke: ISmokeSummary[] = ends
    .filter((end) => end.kind === 'smoke' && FINISHED.has(end.outcome))
    .map((end) => ({
      trialId: end.trialId,
      arm: end.arm,
      taskId: end.taskId,
      outcome: end.outcome,
      failures: end.failures,
      costMicros: end.costMicros,
      callsAdmitted: end.callsAdmitted,
    }));
  const closed = input.slots.filter((slot) =>
    ends.some((end) => end.slotKey === slotKey(slot) && FINISHED.has(end.outcome)),
  ).length;
  return {
    schema: 1,
    finished: closed === input.slots.length,
    slotsTotal: input.slots.length,
    slotsClosed: closed,
    outcome: decision.outcome,
    decision,
    arms,
    byTask,
    uncounted: { smoke, infrastructureStops, byArm: uncountedByArm },
    halts: input.events.filter((event): event is IHalt => event.type === 'halt'),
  };
}
