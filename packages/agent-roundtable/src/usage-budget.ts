import type { ConversationState } from './conversation-state';
import { RoundtableError } from './errors';
import type {
  ModelCallBound,
  ModelCallIntent,
  Money,
  PricePolicy,
  UsageAmount,
  UsageBudget,
  UsageEstimate,
  UsageEstimator,
  UsageReconciliation,
  UsageRecord,
  UsageReservation,
} from './usage-types';
import { isThenable, validBudgetCost, validModelCallBound } from './usage-validation';

export type StoredBudget = NonNullable<ConversationState['definition']['budget']>;

/** What a record counts against a budget, in token and minor-unit sums that never lose precision. */
export interface BudgetCharge {
  tokens: bigint;
  cost: bigint;
}

function invalid(message: string): never {
  throw new RoundtableError('invalid-config', message);
}

function minor(cost: Money | null | undefined): bigint {
  return cost ? BigInt(cost.minorUnits) : 0n;
}

/**
 * The saved form of a configured budget, or null with none. A configuration no admission could ever
 * satisfy is refused here, at construction and at load, rather than on the first call.
 */
export function normalizeBudget(
  budget: UsageBudget | undefined,
  pricing: PricePolicy | undefined,
  estimator: UsageEstimator | undefined,
): StoredBudget | null {
  if (budget === undefined) {
    if (estimator !== undefined) invalid('An estimator requires an estimated budget');
    return null;
  }
  if (budget === null || typeof budget !== 'object' || Array.isArray(budget))
    invalid('A budget must be an object');
  const mode = budget.mode ?? 'strict';
  if (mode !== 'strict' && mode !== 'estimated') invalid('A budget mode is strict or estimated');
  if (budget.tokens === undefined && budget.cost === undefined)
    invalid('A budget requires a token amount, a cost amount or both');
  if (budget.tokens !== undefined && (!Number.isSafeInteger(budget.tokens) || budget.tokens <= 0))
    invalid('A token budget must be a positive safe integer');
  if (
    budget.cost !== undefined &&
    !(validBudgetCost(budget.cost) && BigInt(budget.cost.minorUnits) > 0n)
  )
    invalid('A cost budget must be a named currency with a positive integer amount');
  if (budget.cost !== undefined) {
    if (!pricing) invalid('A cost budget requires a pricing policy');
    if (mode === 'strict' && typeof pricing.bound !== 'function')
      invalid('A strict cost budget requires a pricing policy that declares a call cost bound');
  }
  if (mode === 'estimated' && typeof estimator?.estimate !== 'function')
    invalid('An estimated budget requires an estimator');
  if (mode !== 'estimated' && estimator !== undefined)
    invalid('An estimator is only accepted by an estimated budget');
  return {
    tokens: budget.tokens ?? null,
    cost:
      budget.cost === undefined
        ? null
        : { currency: budget.cost.currency, minorUnits: BigInt(budget.cost.minorUnits).toString() },
    mode,
  };
}

/** The saved budget in the form a configuration accepts, for rebuilding it on load. */
export function budgetOptions(budget: StoredBudget | null): UsageBudget | undefined {
  return budget === null
    ? undefined
    : {
        ...(budget.tokens === null ? {} : { tokens: budget.tokens }),
        ...(budget.cost === null ? {} : { cost: { ...budget.cost } }),
        mode: budget.mode,
      };
}

/** The amount a settled record's own report fully shows, or null while any part of it is unknown. */
function knownUsage(record: UsageRecord, budget: StoredBudget): BudgetCharge | null {
  if (record.status !== 'settled' || !record.final) return null;
  if (record.outcome !== 'completed' && record.outcome !== 'cache-hit') return null;
  if (record.provenance !== 'reported' && record.provenance !== 'estimated') return null;
  let tokens = 0n;
  if (record.outcome !== 'cache-hit') {
    const { input, output } = record.tokens ?? {};
    if (typeof input === 'number' && typeof output === 'number')
      tokens = BigInt(input) + BigInt(output);
    // A cache hit replays a response that was already counted, so it adds no tokens.
    else if (budget.tokens !== null) return null;
  }
  let cost = 0n;
  if (budget.cost !== null) {
    const priced = record.price?.cost;
    if (!priced || priced.currency !== budget.cost.currency) return null;
    cost = minor(priced);
  }
  return { tokens, cost };
}

/** What a record whose usage is not fully known keeps counting: the larger of its bound and its report. */
function retainedBound(record: UsageRecord, budget: StoredBudget): BudgetCharge {
  let tokens = BigInt(record.reservation?.tokens ?? 0);
  let cost = budget.cost === null ? 0n : minor(record.reservation?.cost);
  if (record.status === 'settled') {
    const shown = BigInt(record.tokens?.input ?? 0) + BigInt(record.tokens?.output ?? 0);
    if (shown > tokens) tokens = shown;
    const priced = record.price?.cost;
    if (budget.cost !== null && priced && priced.currency === budget.cost.currency)
      cost = minor(priced) > cost ? minor(priced) : cost;
  }
  return { tokens, cost };
}

/**
 * What one record counts against a budget. A host reconcile decides it; else a report that fully shows
 * the usage; else the bound admission set aside, raised to anything the report proves, since a refund
 * on a guess would let a budget be overspent. An admission-free cache hit never reserved anything,
 * so it counts its actual usage or nothing.
 */
export function recordCharge(record: UsageRecord, budget: StoredBudget): BudgetCharge {
  if (record.reconciled)
    return {
      tokens: BigInt(record.reconciled.tokens),
      cost: budget.cost === null ? 0n : minor(record.reconciled.cost),
    };
  const known = knownUsage(record, budget);
  if (known) return known;
  if (!record.admitted) {
    const priced = record.price?.cost;
    return {
      tokens: 0n,
      cost: budget.cost !== null && priced?.currency === budget.cost.currency ? minor(priced) : 0n,
    };
  }
  return retainedBound(record, budget);
}

/** Everything the ledger counts against a budget so far. */
export function budgetSpent(records: readonly UsageRecord[], budget: StoredBudget): BudgetCharge {
  let tokens = 0n;
  let cost = 0n;
  for (const record of records) {
    const charge = recordCharge(record, budget);
    tokens += charge.tokens;
    cost += charge.cost;
  }
  return { tokens, cost };
}

/** Whether any amount of the budget is fully spent, so no call can be admitted under it. */
export function budgetExhausted(records: readonly UsageRecord[], budget: StoredBudget): boolean {
  const spent = budgetSpent(records, budget);
  return (
    (budget.tokens !== null && spent.tokens >= BigInt(budget.tokens)) ||
    (budget.cost !== null && spent.cost >= minor(budget.cost))
  );
}

function synchronous<T>(value: T, what: string): T {
  if (isThenable(value)) invalid(`${what} must return synchronously`);
  return value;
}

function priceBound(value: Money | null, budget: StoredBudget, what: string): Money | null {
  if (value === null) return null;
  if (!validBudgetCost(value, budget.cost?.currency))
    invalid(`${what} must be a non-negative amount in the budget currency`);
  return value;
}

function runEstimator(
  estimator: UsageEstimator | undefined,
  call: ModelCallIntent,
  budget: StoredBudget,
): UsageEstimate {
  if (typeof estimator?.estimate !== 'function')
    invalid('An estimated budget requires an estimator');
  const estimate = synchronous(estimator.estimate({ ...call }), 'The estimator');
  if (estimate === null || typeof estimate !== 'object' || Array.isArray(estimate))
    invalid('The estimator must return an estimate object');
  if (estimate.bound !== undefined && !validModelCallBound(estimate.bound))
    invalid('The estimator returned an invalid call bound');
  if (estimate.cost !== undefined) priceBound(estimate.cost, budget, 'The estimated cost');
  return estimate;
}

/**
 * The amount admission sets aside for a call: its declared bound, or in an estimated budget the
 * estimator's for a call that declared none. Run inside the serialized state update, so it is
 * synchronous. A call a budget cannot bound is refused rather than admitted unbounded.
 */
export function resolveReservation(
  call: ModelCallIntent,
  budget: StoredBudget,
  pricing: PricePolicy | undefined,
  estimator: UsageEstimator | undefined,
): UsageReservation {
  let provenance: UsageReservation['provenance'] = 'declared';
  let estimate: UsageEstimate | undefined;
  const estimated = (): UsageEstimate => (estimate ??= runEstimator(estimator, call, budget));
  let bound: ModelCallBound | undefined = call.bound;
  if (bound === undefined) {
    if (budget.mode !== 'estimated')
      invalid('A strict budget requires every call to declare its bound');
    bound = estimated().bound;
    if (bound === undefined)
      invalid('The estimator returned no bound for a call that declared none');
    provenance = 'estimated';
  }
  let cost: Money | null = null;
  if (budget.cost !== null) {
    if (typeof pricing?.bound === 'function')
      cost = priceBound(
        synchronous(pricing.bound({ ...call, bound }), 'The pricing bound'),
        budget,
        'The pricing bound',
      );
    if (cost === null && budget.mode === 'estimated') {
      cost = estimated().cost ?? null;
      if (cost !== null) provenance = 'estimated';
    }
    if (cost === null) invalid('The call cannot be priced, so the budget cannot admit it');
  }
  return { tokens: bound.inputTokens + bound.maxOutputTokens, cost, provenance };
}

/** Refuses a call whose reservation does not fit beside what is spent; equality is admitted. */
export function admitUnderBudget(
  records: readonly UsageRecord[],
  budget: StoredBudget,
  reservation: UsageReservation,
): void {
  const spent = budgetSpent(records, budget);
  if (budget.tokens !== null && spent.tokens + BigInt(reservation.tokens) > BigInt(budget.tokens))
    throw new RoundtableError('budget-limit', 'Token budget would be exceeded');
  if (budget.cost !== null && spent.cost + minor(reservation.cost) > minor(budget.cost))
    throw new RoundtableError('budget-limit', 'Cost budget would be exceeded');
}

function sameAmount(a: UsageAmount, b: UsageAmount): boolean {
  return (
    a.tokens === b.tokens &&
    (a.cost?.currency ?? null) === (b.cost?.currency ?? null) &&
    (a.cost?.minorUnits ?? null) === (b.cost?.minorUnits ?? null)
  );
}

/**
 * Validates a host reconcile against the ledger. Returns the record's index and the amount to store,
 * or null when the same amounts were already stored, which is a no-op rather than a second write.
 */
function planReconciliation(
  state: ConversationState,
  input: UsageReconciliation,
): { index: number; amount: UsageAmount } | null {
  const budget = state.definition.budget;
  if (budget === null) invalid('Reconciling usage requires a budget');
  if (typeof input?.callId !== 'string' || !input.callId) invalid('A reconcile requires a call id');
  if (!Number.isSafeInteger(input.tokens) || input.tokens < 0)
    invalid('Reconciled tokens must be a non-negative safe integer');
  if (budget.cost === null) {
    if (input.cost !== undefined) invalid('Reconciled cost requires a cost budget');
  } else if (input.cost === undefined || !validBudgetCost(input.cost, budget.cost.currency)) {
    invalid('A cost budget requires a non-negative reconciled cost in its currency');
  }
  const amount: UsageAmount = {
    tokens: input.tokens,
    cost:
      input.cost === undefined
        ? null
        : { currency: input.cost.currency, minorUnits: BigInt(input.cost.minorUnits).toString() },
  };
  const usage = state.snapshot.usage;
  const index = usage.findIndex((record) => record.callId === input.callId);
  const record = usage[index];
  if (!record)
    throw new RoundtableError('conflict', 'Reconcile names a call that is not in the ledger');
  if (!record.admitted)
    throw new RoundtableError(
      'conflict',
      'A call that was never admitted has nothing to reconcile',
    );
  if (record.reconciled) {
    if (sameAmount(record.reconciled, amount)) return null;
    throw new RoundtableError('conflict', 'Call was already reconciled to different amounts');
  }
  if (knownUsage(record, budget))
    throw new RoundtableError(
      'conflict',
      'A call whose usage is fully reported needs no reconcile',
    );
  return { index, amount };
}

/** Whether a reconcile would change nothing; throws exactly when `reconcileModelCall` would. */
export function reconciliationIsNoop(
  state: ConversationState,
  input: UsageReconciliation,
): boolean {
  return planReconciliation(state, input) === null;
}

/**
 * Pure mutator run inside `persistence.update`. Replaces the bound a call keeps counted with the
 * host's amounts; the call's status, outcome and call counts do not change.
 */
export function reconcileModelCall(
  state: ConversationState,
  revision: number,
  input: UsageReconciliation,
): void {
  const plan = planReconciliation(state, input);
  if (plan === null) return;
  const record = state.snapshot.usage[plan.index];
  state.snapshot.usage[plan.index] = { ...record, revision, reconciled: plan.amount };
}
