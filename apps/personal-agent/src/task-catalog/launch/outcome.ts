/**
 * How a launched task ended, decided from what the host recorded and never from what the model said.
 * The goal's own ending says whether the run errored or was stopped; for a run that finished, the
 * definition revision's evidence rule says whether the host's recorded receipts prove the work. A run
 * that finished without that proof is unverified, which is not a failure and not a success: the
 * model's report is shown as its own account. A run that the host's browser kept from a page other
 * than the one named is unverified too, whatever else it read, since a result that rests on a run
 * that went beyond its task cannot be confirmed. The decision is a pure function of the goal, its
 * deciding run and the receipts of that run, so the same record always yields the same outcome.
 */
import {
  TaskCatalogRefusedError,
  asRecord,
  isoTime,
  listOf,
  oneOf,
  rejectUnknownKeys,
  shaped,
  singleLine,
} from '../fields.js';
import { ruleFor } from './evidence-rules.js';
import { isPageRefusal, parseReceipt } from './receipts.js';
import { OUTCOME_STATES } from '../types.js';

import type { IGoal, IGoalRun } from '@robota-sdk/agent-product/personal';
import type { IEvidenceRule } from './evidence-rules.js';
import type { IEvidenceReceipt, ILaunchIntent, ILaunchOutcome, IRunReceipt } from './types.js';

export const OUTCOME_LIMITS = {
  reason: 300,
  /** The longest report an outcome keeps; a longer one is cut and says so. */
  report: 2000,
  /** How many receipts an outcome keeps for the person to see. */
  evidence: 8,
} as const;

const RUN_ID = /^[a-z0-9][a-z0-9-]{0,79}$/u;
/** Control characters other than a line break, and the ones that reorder displayed text. */
const UNSAFE = /[^\P{Cc}\n]|[\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

/** The report as plain text for display: no control characters, no more than the bound. */
export function plainReport(report: string): string {
  const text = report
    .replace(/\r\n?/gu, '\n')
    .replace(UNSAFE, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  return text.length <= OUTCOME_LIMITS.report
    ? text
    : `${text.slice(0, OUTCOME_LIMITS.report - 1)}…`;
}

/** The statuses a one-shot goal does not leave: its run is over and nothing will start another. */
const OVER: ReadonlySet<IGoal['status']> = new Set(['done', 'failed']);

export interface IOutcomeInput {
  readonly intent: ILaunchIntent;
  /** Absent when the goal was removed. */
  readonly goal: IGoal | undefined;
  /** The goal's newest run. */
  readonly run: IGoalRun | undefined;
  readonly rules: readonly IEvidenceRule[];
  readonly now: Date;
}

const outcome = (
  state: ILaunchOutcome['state'],
  reason: string,
  at: Date,
  run?: IGoalRun,
  evidence: readonly IEvidenceReceipt[] = [],
): ILaunchOutcome => {
  const report = run?.report === undefined ? '' : plainReport(run.report);
  return {
    state,
    reason,
    evidence: evidence.slice(0, OUTCOME_LIMITS.evidence),
    decidedAt: at.toISOString(),
    ...(run !== undefined && { runId: run.id }),
    ...(report !== '' && { report }),
  };
};

const bare = ({ runId: _runId, ...receipt }: IRunReceipt): IEvidenceReceipt => receipt;

/** What the person is told when the browser kept the run from a page other than the one named. */
const KEPT_FROM_PAGE =
  'The run was kept from a page other than the one you named, so its result cannot be confirmed.';

/**
 * The outcome for a launched intent, or nothing while its goal is still going to run (or run again).
 * A goal that was removed was stopped by the person. A run that errored is failed; one that was
 * stopped is cancelled; one that finished is unverified when the browser kept it from another page,
 * and otherwise as the rule for the definition revision finds, and with no rule it cannot be verified.
 */
export function decideOutcome(input: IOutcomeInput): ILaunchOutcome | undefined {
  const { intent, goal, run, rules, now } = input;
  if (goal === undefined)
    return outcome('cancelled', 'The goal for this task was removed before it finished.', now);
  if (!OVER.has(goal.status)) return undefined;
  if (run === undefined)
    return outcome(
      'failed',
      'The run ended without leaving a record, so nothing could be checked.',
      now,
    );
  if (run.endedAt === undefined) return undefined;
  if (run.outcome === 'failed')
    return outcome('failed', 'The run ended with an error before it finished.', now, run);
  if (run.outcome === 'interrupted')
    return outcome('cancelled', 'The run was stopped before it finished.', now, run);
  const kept = (intent.receipts ?? []).filter((receipt) => receipt.runId === run.id);
  const reads = kept.filter((receipt): receipt is IRunReceipt => !isPageRefusal(receipt)).map(bare);
  // A look before any open is only noted: it read nothing and asked for nothing the person did not name.
  if (kept.some((receipt) => isPageRefusal(receipt) && receipt.reason !== 'not-opened'))
    return outcome('unverified', KEPT_FROM_PAGE, now, run, reads);
  const rule = ruleFor(rules, { id: intent.definitionId, revision: intent.definitionRevision });
  if (rule === undefined)
    return outcome(
      'unverified',
      'This task has no check of its result yet, so the report cannot be confirmed.',
      now,
      run,
      reads,
    );
  const verdict = rule.check({ inputs: intent.inputs, report: run.report ?? '', receipts: reads });
  if (!verdict.satisfied) return outcome('unverified', verdict.reason, now, run, reads);
  const keyOf = (receipt: IEvidenceReceipt): string =>
    [receipt.tool, receipt.address, receipt.digest, receipt.at].join(' ');
  const proof = new Set(verdict.evidence.map(keyOf));
  return outcome('verified', verdict.reason, now, run, [
    ...verdict.evidence,
    ...reads.filter((receipt) => !proof.has(keyOf(receipt))),
  ]);
}

/** A kept outcome, read back field by field. */
export function parseOutcome(raw: unknown): ILaunchOutcome {
  const kept = asRecord(raw, 'outcome');
  rejectUnknownKeys(
    kept,
    ['state', 'reason', 'evidence', 'decidedAt', 'runId', 'report'],
    'outcome',
  );
  const report = kept['report'];
  if (
    report !== undefined &&
    (typeof report !== 'string' ||
      report.trim() === '' ||
      report.length > OUTCOME_LIMITS.report ||
      new RegExp(UNSAFE.source, 'u').test(report))
  )
    throw new TaskCatalogRefusedError('outcome.report must be plain text of a bounded length');
  return {
    state: oneOf(kept['state'], 'outcome.state', OUTCOME_STATES),
    reason: singleLine(kept['reason'], 'outcome.reason', OUTCOME_LIMITS.reason),
    evidence: listOf(kept['evidence'], 'outcome.evidence', 0, OUTCOME_LIMITS.evidence).map(
      (entry, index) => parseReceipt(entry, `outcome.evidence[${index}]`),
    ),
    decidedAt: isoTime(kept['decidedAt'], 'outcome.decidedAt'),
    ...(kept['runId'] !== undefined && {
      runId: shaped(kept['runId'], 'outcome.runId', RUN_ID, 80),
    }),
    ...(typeof report === 'string' && { report }),
  };
}
