import { integer, text } from './state-codec-values';

/**
 * The write path (`usage-ledger.ts`) and the load codec (`state-codec-usage.ts`) must accept exactly
 * the same shapes, or a record either path admits becomes unloadable, or unwriteable once loaded.
 * These are shared so the two cannot drift apart.
 */
export const USAGE_OUTCOMES = ['completed', 'failed', 'cancelled', 'cache-hit'] as const;
export const USAGE_PROVENANCES = ['reported', 'partial', 'estimated', 'unknown'] as const;
export const USAGE_TOKEN_KEYS = [
  'input',
  'output',
  'cacheRead',
  'cacheWrite',
  'reasoning',
] as const;

/**
 * A token map both paths accept: only recognized counters, each a non-negative integer. Fractional
 * or negative counts are never valid; a reporter with fractional provider counts must round them.
 */
export function validUsageTokens(tokens: unknown): boolean {
  if (tokens === null || typeof tokens !== 'object' || Array.isArray(tokens)) return false;
  const entries = tokens as Record<string, unknown>;
  return Object.keys(entries).every(
    (key) => (USAGE_TOKEN_KEYS as readonly string[]).includes(key) && integer(entries[key]),
  );
}

/** A `Money` both paths accept: a named currency and an integer amount string. */
export function validUsageCost(cost: unknown): boolean {
  if (cost === null || typeof cost !== 'object' || Array.isArray(cost)) return false;
  const money = cost as Record<string, unknown>;
  return (
    text(money.currency) && typeof money.minorUnits === 'string' && /^-?\d+$/.test(money.minorUnits)
  );
}

/** Whether a value is promise-like; a hostile `then` accessor counts as not being one. */
export function isThenable(value: unknown): boolean {
  try {
    return (
      (typeof value === 'object' || typeof value === 'function') &&
      value !== null &&
      typeof (value as { then?: unknown }).then === 'function'
    );
  } catch {
    return false;
  }
}

/** Drops an abandoned promise-like result so its later rejection is not reported as unhandled. */
export function abandonThenable(value: unknown): void {
  try {
    void Promise.resolve(value).catch(() => {});
  } catch {
    // A hostile `then` accessor has nothing further to settle.
  }
}

/** A bound both paths accept: two non-negative safe integers whose sum is still a safe integer. */
export function validModelCallBound(bound: unknown): boolean {
  if (bound === null || typeof bound !== 'object' || Array.isArray(bound)) return false;
  const entries = bound as Record<string, unknown>;
  return (
    Object.keys(entries).length === 2 &&
    integer(entries.inputTokens) &&
    integer(entries.maxOutputTokens) &&
    Number.isSafeInteger(entries.inputTokens + entries.maxOutputTokens)
  );
}

/** An amount that can be added to a budget: a valid cost that is not negative, in the given currency. */
export function validBudgetCost(cost: unknown, currency?: string): boolean {
  return (
    validUsageCost(cost) &&
    !(cost as { minorUnits: string }).minorUnits.startsWith('-') &&
    (currency === undefined || (cost as { currency: string }).currency === currency)
  );
}

/** A `UsageAmount` both paths accept; its cost is present exactly when the budget has a cost amount. */
export function validUsageAmount(amount: unknown, currency: string | null): boolean {
  if (amount === null || typeof amount !== 'object' || Array.isArray(amount)) return false;
  const entries = amount as Record<string, unknown>;
  return (
    Object.keys(entries).length === 2 &&
    integer(entries.tokens) &&
    (currency === null ? entries.cost === null : validBudgetCost(entries.cost, currency))
  );
}
