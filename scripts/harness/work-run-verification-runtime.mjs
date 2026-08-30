import { MAX_RANGE_COMMITS, MAX_RANGE_RECEIPTS } from './work-run-validation-foundation.mjs';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_COMMAND_BUDGET = 2_500;
const DEFAULT_QUERY_BUDGET = MAX_RANGE_COMMITS * 2 + MAX_RANGE_RECEIPTS + 32;
const MAX_OPERATION_TIMEOUT_MS = 10_000;

export class WorkRunVerificationBudgetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkRunVerificationBudgetError';
    this.code = 'WORK_RUN_VERIFICATION_BUDGET_EXHAUSTED';
  }
}

export function createWorkRunVerificationRuntime({
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
    throw new TypeError('work-run verification runtime options are invalid');
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
    throw new WorkRunVerificationBudgetError('work-run verification deadline exhausted');
  }
  if (!Number.isInteger(runtime[field]) || runtime[field] < 1) {
    throw new WorkRunVerificationBudgetError(`work-run verification ${label} budget exhausted`);
  }
  runtime[field] -= 1;
  return Math.min(MAX_OPERATION_TIMEOUT_MS, remainingMs);
}

export function takeWorkRunVerificationCommand(runtime) {
  return take(runtime, 'commandsRemaining', 'command');
}

export function takeWorkRunVerificationQuery(runtime) {
  return take(runtime, 'remaining', 'query');
}

export function isWorkRunVerificationBudgetError(error) {
  return error?.code === 'WORK_RUN_VERIFICATION_BUDGET_EXHAUSTED';
}
