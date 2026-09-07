// Generic timeout/budget guard for a verification pass that issues a bounded number of external
// commands/queries within a wall-clock deadline. Originally lived under the work-run-* family
// (naming only — no functional tie to work-run measurement); split out so post-findings
// verification does not depend on that subsystem.

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_COMMAND_BUDGET = 2_500;
const DEFAULT_QUERY_BUDGET = 2_132;
const MAX_OPERATION_TIMEOUT_MS = 10_000;

export class VerificationBudgetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VerificationBudgetError';
    this.code = 'VERIFICATION_BUDGET_EXHAUSTED';
  }
}

export function createVerificationRuntime({
  now = Date.now,
  startedAt = now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  commandBudget = DEFAULT_COMMAND_BUDGET,
  queryBudget = DEFAULT_QUERY_BUDGET,
} = {}) {
  if (
    typeof now !== 'function' ||
    !Number.isFinite(startedAt) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isInteger(commandBudget) ||
    commandBudget < 0 ||
    !Number.isInteger(queryBudget) ||
    queryBudget < 0
  ) {
    throw new TypeError('verification runtime options are invalid');
  }
  return {
    now,
    deadline: startedAt + timeoutMs,
    commandsRemaining: commandBudget,
    remaining: queryBudget,
  };
}

function take(runtime, field, label) {
  const remainingMs = runtime.deadline - runtime.now();
  if (remainingMs < 1) {
    throw new VerificationBudgetError('verification deadline exhausted');
  }
  if (!Number.isInteger(runtime[field]) || runtime[field] < 1) {
    throw new VerificationBudgetError(`verification ${label} budget exhausted`);
  }
  runtime[field] -= 1;
  return Math.min(MAX_OPERATION_TIMEOUT_MS, remainingMs);
}

export function takeVerificationCommand(runtime) {
  return take(runtime, 'commandsRemaining', 'command');
}

export function takeVerificationQuery(runtime) {
  return take(runtime, 'remaining', 'query');
}

export function isVerificationBudgetError(error) {
  return error?.code === 'VERIFICATION_BUDGET_EXHAUSTED';
}
