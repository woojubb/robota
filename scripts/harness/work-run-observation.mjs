/**
 * Process-boundary contract for whether Work-Run validation observes an unpublished candidate or
 * an already-published head. The outer lifecycle boundary owns the value; nested scanners parse it.
 */
export const WORK_RUN_PR_OBSERVATION_ENV = 'HARNESS_WORK_RUN_PR_OBSERVATION';

const WORK_RUN_PR_OBSERVATIONS = new Set(['pre-push', 'post-push']);

export function parseWorkRunPrObservation(env = process.env) {
  const value = env[WORK_RUN_PR_OBSERVATION_ENV];
  if (value === undefined) return undefined;
  if (WORK_RUN_PR_OBSERVATIONS.has(value)) return value;
  throw new Error(
    `work-run-measurement: invalid ${WORK_RUN_PR_OBSERVATION_ENV} observation ` +
      `"${value}"; expected pre-push or post-push`,
  );
}
