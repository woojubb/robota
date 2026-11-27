import type { ICodingObservation } from './outcome-coding-verify.js';

/** What the trial itself reported, independent of the verifier's observation. */
export interface ITrialReport {
  /** The agent's run reached a normal completion. */
  readonly completed: boolean;
  /** The run was cancelled or cut off before it finished. */
  readonly interrupted: boolean;
  /** Number of tool calls the agent made. */
  readonly toolCalls: number;
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
  if (observation.timedOut) failures.push('verifier-timed-out');
  if (observation.exitCode !== 0) failures.push('verifier-failed');
  if (!observation.protectedFilesUnchanged) failures.push('protected-files-changed');
  if (!observation.noUnexpectedFiles) failures.push('unexpected-files');
  if (!observation.noEscapes) failures.push('escaping-entries');
  return { passed: failures.length === 0, failures };
}
