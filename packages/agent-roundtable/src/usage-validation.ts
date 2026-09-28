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
