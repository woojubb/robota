import type { ICodingObservation } from './outcome-coding-verify.js';

/** What the trial itself reported, independent of the verifier's observation. */
export interface ITrialReport {
  /** The agent's run reached a normal completion. */
  readonly completed: boolean;
  /** The run was cancelled or cut off before it finished. */
  readonly interrupted: boolean;
  /** Number of tool calls the agent made. */
  readonly toolCalls: number;
  /** The trial hit its call cap: it ends as failed and stays in the denominator. */
  readonly capReached?: boolean;
  /** The relay stopped the run (an unattributed call, or the spend gate). */
  readonly stopped?: boolean;
  /**
   * Set for the delegation arm: the number of model calls the host attributed to child roles. A
   * parent that claims the work is done without ever delegating it has none.
   */
  readonly childCalls?: number;
}

export interface ITrialScore {
  readonly passed: boolean;
  /** Every rule that failed, in a fixed order; empty exactly when `passed`. */
  readonly failures: readonly string[];
}

/**
 * A trial passes only if it completed, was not interrupted, used tools, the verifier exited 0,
 * and nothing protected was changed and nothing unexpected or escaping was added. Pure: the
 * verdict comes from the environment observation, with the agent's claim as data only.
 */
export function scoreTrial(report: ITrialReport, observation: ICodingObservation): ITrialScore {
  const failures: string[] = [];
  if (!report.completed) failures.push('not-completed');
  if (report.interrupted) failures.push('interrupted');
  if (report.toolCalls < 1) failures.push('no-tools-used');
  if (report.childCalls !== undefined && report.childCalls < 1) failures.push('not-delegated');
  if (report.capReached === true) failures.push('call-cap');
  if (report.stopped === true) failures.push('run-stopped');
  if (observation.timedOut) failures.push('verifier-timed-out');
  if (observation.exitCode !== 0) failures.push('verifier-failed');
  if (!observation.protectedFilesUnchanged) failures.push('protected-files-changed');
  if (!observation.noUnexpectedFiles) failures.push('unexpected-files');
  if (!observation.noEscapes) failures.push('escaping-entries');
  return { passed: failures.length === 0, failures };
}
