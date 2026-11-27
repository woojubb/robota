import { describe, expect, it } from 'vitest';
import { budgetExhausted, budgetSpent, recordCharge, type StoredBudget } from './usage-budget';
import type { UsageRecord } from './usage-types';

const tokenBudget: StoredBudget = { tokens: 100, cost: null, mode: 'strict' };
const costBudget: StoredBudget = {
  tokens: null,
  cost: { currency: 'USD', minorUnits: '1000' },
  mode: 'strict',
};
const bothBudget: StoredBudget = {
  tokens: 100,
  cost: { currency: 'USD', minorUnits: '1000' },
  mode: 'strict',
};

const usd = (minorUnits: string) => ({ currency: 'USD', minorUnits });

/** A record that has only been admitted, reserving 50 tokens and 500 minor units. */
function reserved(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    callId: 'c',
    providerId: 'p',
    modelId: 'm',
    conversationId: 'room',
    runId: 'run',
    principal: { kind: 'participant', id: 'a' },
    turnId: 't',
    groupId: 'g',
    attemptId: 'at',
    status: 'reserved',
    revision: 1,
    price: null,
    admitted: true,
    reservation: { tokens: 50, cost: usd('500'), provenance: 'declared' },
    reconciled: null,
    ...overrides,
  } as UsageRecord;
}

function settled(report: Record<string, unknown>, overrides: Partial<UsageRecord> = {}): UsageRecord {
  return reserved({
    status: 'settled',
    outcome: 'completed',
    provenance: 'reported',
    final: true,
    tokens: { input: 10, output: 5 },
    price: { version: 'v1', cost: usd('30') },
    ...report,
    ...overrides,
  } as Partial<UsageRecord>);
}

describe('what a record counts against a budget', () => {
  it.each([
    ['a record that is only reserved', reserved(), { tokens: 50n, cost: 500n }],
    ['a completed call whose final report shows its usage', settled({}), { tokens: 15n, cost: 30n }],
    [
      'a completed call that used more than its bound',
      settled({ tokens: { input: 90, output: 60 }, price: { version: 'v1', cost: usd('900') } }),
      { tokens: 150n, cost: 900n },
    ],
    [
      'a final report with only the cache counters beyond input and output',
      settled({ tokens: { input: 10, output: 5, cacheRead: 999, reasoning: 999 } }),
      { tokens: 15n, cost: 30n },
    ],
    [
      'a call that is still open to replacement',
      settled({ final: false }),
      { tokens: 50n, cost: 500n },
    ],
    [
      'a failed call',
      settled({ outcome: 'failed', tokens: { input: 1, output: 1 } }),
      { tokens: 50n, cost: 500n },
    ],
    [
      'a cancelled call',
      settled({ outcome: 'cancelled', tokens: { input: 1, output: 1 } }),
      { tokens: 50n, cost: 500n },
    ],
    ['a partial report', settled({ provenance: 'partial' }), { tokens: 50n, cost: 500n }],
    ['an unknown report', settled({ provenance: 'unknown' }), { tokens: 50n, cost: 500n }],
    [
      'a report missing its output tokens',
      settled({ tokens: { input: 10 } }),
      { tokens: 50n, cost: 500n },
    ],
    [
      'a report with no price',
      settled({ price: { version: 'v1', cost: null } }),
      { tokens: 50n, cost: 500n },
    ],
    [
      'a partial report that shows more than the bound',
      settled({ provenance: 'partial', tokens: { input: 40, output: 30 }, price: { version: 'v1', cost: usd('800') } }),
      { tokens: 70n, cost: 800n },
    ],
    [
      'a cache hit that was admitted, which adds no tokens but keeps its price',
      settled({ outcome: 'cache-hit', tokens: undefined }),
      { tokens: 0n, cost: 30n },
    ],
    [
      'a call the host reconciled, over everything it reported',
      settled({}, { reconciled: { tokens: 7, cost: usd('9') } }),
      { tokens: 7n, cost: 9n },
    ],
    [
      'a reserved call the host reconciled',
      reserved({ reconciled: { tokens: 0, cost: usd('0') } }),
      { tokens: 0n, cost: 0n },
    ],
    [
      'a cache hit that never needed admission and has no price',
      settled(
        { outcome: 'cache-hit', tokens: undefined, price: null },
        { admitted: false, reservation: null },
      ),
      { tokens: 0n, cost: 0n },
    ],
    [
      'a cache hit that never needed admission and is priced',
      settled(
        { outcome: 'cache-hit', tokens: undefined },
        { admitted: false, reservation: null },
      ),
      { tokens: 0n, cost: 30n },
    ],
  ])('%s', (_label, record, expected) => {
    expect(recordCharge(record, bothBudget)).toEqual(expected);
  });

  it('counts only tokens under a token budget and only cost under a cost budget', () => {
    expect(recordCharge(reserved(), tokenBudget)).toEqual({ tokens: 50n, cost: 0n });
    expect(recordCharge(reserved(), costBudget)).toEqual({ tokens: 50n, cost: 500n });
    // A cost budget never needs tokens, so a report without them still fully shows its cost.
    expect(recordCharge(settled({ tokens: undefined }), costBudget)).toEqual({
      tokens: 0n,
      cost: 30n,
    });
    // A token budget never needs a price.
    expect(recordCharge(settled({ price: null }), tokenBudget)).toEqual({ tokens: 15n, cost: 0n });
  });

  it('keeps the bound when the price is in another currency than the budget', () => {
    const foreign = settled({ price: { version: 'v1', cost: { currency: 'EUR', minorUnits: '1' } } });
    expect(recordCharge(foreign, costBudget)).toEqual({ tokens: 50n, cost: 500n });
  });

  it('sums beyond the largest safe integer without losing precision', () => {
    const huge = Number.MAX_SAFE_INTEGER;
    const records = [1, 2, 3].map((n) =>
      settled({ tokens: { input: huge, output: 0 } }, { callId: `c${n}` }),
    );
    expect(budgetSpent(records, tokenBudget).tokens).toBe(3n * BigInt(huge));
    const money = [1, 2].map((n) =>
      reserved({
        callId: `m${n}`,
        reservation: { tokens: 1, cost: usd('9007199254740993'), provenance: 'declared' },
      }),
    );
    expect(budgetSpent(money, costBudget).cost).toBe(18014398509481986n);
  });

  it('is exhausted exactly when any amount is fully spent', () => {
    const at = (tokens: number, cost: string) =>
      reserved({ reservation: { tokens, cost: usd(cost), provenance: 'declared' } });
    expect(budgetExhausted([at(99, '999')], bothBudget)).toBe(false);
    expect(budgetExhausted([at(100, '999')], bothBudget)).toBe(true);
    expect(budgetExhausted([at(99, '1000')], bothBudget)).toBe(true);
    expect(budgetExhausted([], bothBudget)).toBe(false);
  });
});
