import { describe, expect, it } from 'vitest';
import type { ConversationState } from './conversation-state';
import { RoundtableError } from './errors';
import { budgetSpent, reconcileModelCall, recordCharge, type StoredBudget } from './usage-budget';
import { reserveModelCall, spentLimit, type UsageContext } from './usage-ledger';
import { applyCallSettlement } from './usage-settlement';
import {
  summarizeUsage,
  type CallSettlement,
  type PricePolicy,
  type UsageReport,
} from './usage-types';

const usd = (minorUnits: string) => ({ currency: 'USD', minorUnits });

/** One minor unit per token, so a bound and a report price exactly what they count. */
const perToken: PricePolicy = {
  version: 'per-token',
  cost: (record) =>
    record.status === 'settled' && record.tokens
      ? usd(String((record.tokens.input ?? 0) + (record.tokens.output ?? 0)))
      : null,
  bound: (call) => usd(String(call.bound.inputTokens + call.bound.maxOutputTokens)),
};

const ctx: UsageContext = {
  conversationId: 'room',
  runId: 'run-1',
  principal: { kind: 'participant', id: 'a' },
  turnId: 't',
  groupId: 'g',
  attemptId: 'attempt-1',
};

function stateOf(
  budget: StoredBudget | null,
  limits: Partial<ConversationState['definition']['limits']> = {},
): ConversationState {
  return {
    definition: {
      limits: {
        maxTurnsPerRun: 10,
        timeoutMs: null,
        maxModelCallsPerRun: null,
        maxModelCallsPerConversation: null,
        maxModelCallsPerParticipant: null,
        ...limits,
      },
      budget,
    },
    snapshot: { usage: [] },
  } as unknown as ConversationState;
}

const bound = (inputTokens: number, maxOutputTokens: number) => ({ inputTokens, maxOutputTokens });

function admit(
  state: ConversationState,
  callId: string,
  callBound = bound(60, 40),
  context = ctx,
  kind: 'model' | 'tool-effect' = 'model',
): void {
  reserveModelCall(
    state,
    1,
    context,
    { callId, providerId: kind === 'model' ? 'p' : 'tool', modelId: 'm', bound: callBound },
    { pricing: perToken },
    kind,
  );
}

function settle(state: ConversationState, settlement: CallSettlement, context = ctx): void {
  applyCallSettlement(state, 2, context, settlement, perToken);
}

function refusal(action: () => void): RoundtableError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(RoundtableError);
    return error as RoundtableError;
  }
  throw new Error('expected a refusal');
}

const tokenBudget: StoredBudget = { tokens: 200, cost: null, mode: 'strict' };
const bothBudget: StoredBudget = { tokens: 200, cost: usd('200'), mode: 'strict' };
const completed: UsageReport = {
  callId: 'c1',
  outcome: 'completed',
  provenance: 'reported',
  final: true,
  tokens: { input: 7, output: 3 },
};

describe('a call proven never dispatched', () => {
  it('releases exactly what admission set aside and keeps the record settled', () => {
    const state = stateOf(bothBudget);
    admit(state, 'c1', bound(60, 40));
    admit(state, 'c2', bound(30, 20));
    expect(budgetSpent(state.snapshot.usage, bothBudget)).toEqual({ tokens: 150n, cost: 150n });
    settle(state, { kind: 'not-dispatched', callId: 'c1' });
    expect(budgetSpent(state.snapshot.usage, bothBudget)).toEqual({ tokens: 50n, cost: 50n });
    expect(state.snapshot.usage[0]).toMatchObject({
      status: 'settled',
      outcome: 'not-dispatched',
      provenance: 'reported',
      final: true,
      revision: 2,
      price: { version: 'per-token', cost: null },
      reservation: { tokens: 100, cost: usd('100'), provenance: 'declared' },
    });
    expect(state.snapshot.usage[0]).not.toHaveProperty('tokens');
  });

  it('refunds without float drift at amounts beyond 2^53', () => {
    const huge = (2n ** 60n + 7n).toString();
    const budget: StoredBudget = {
      tokens: null,
      cost: usd((2n ** 70n).toString()),
      mode: 'strict',
    };
    const priceHuge: PricePolicy = { ...perToken, bound: () => usd(huge) };
    const state = stateOf(budget);
    reserveModelCall(
      state,
      1,
      ctx,
      { callId: 'big', providerId: 'p', modelId: 'm', bound: bound(1, 1) },
      { pricing: priceHuge },
    );
    reserveModelCall(
      state,
      1,
      ctx,
      { callId: 'small', providerId: 'p', modelId: 'm', bound: bound(1, 1) },
      { pricing: { ...perToken, bound: () => usd('3') } },
    );
    expect(budgetSpent(state.snapshot.usage, budget).cost).toBe(2n ** 60n + 10n);
    settle(state, { kind: 'not-dispatched', callId: 'big' });
    expect(budgetSpent(state.snapshot.usage, budget).cost).toBe(3n);
  });

  it('frees the budget for a call that would not have fit', () => {
    const state = stateOf(tokenBudget);
    admit(state, 'c1', bound(100, 50));
    expect(refusal(() => admit(state, 'c2', bound(40, 20))).code).toBe('budget-limit');
    settle(state, { kind: 'not-dispatched', callId: 'c1' });
    admit(state, 'c2', bound(40, 20));
    expect(budgetSpent(state.snapshot.usage, tokenBudget).tokens).toBe(60n);
  });

  it('still counts a model call against every call limit', () => {
    const state = stateOf(tokenBudget, {
      maxModelCallsPerRun: 1,
      maxModelCallsPerConversation: 1,
      maxModelCallsPerParticipant: 1,
    });
    admit(state, 'c1', bound(10, 10));
    settle(state, { kind: 'not-dispatched', callId: 'c1' });
    expect(refusal(() => admit(state, 'c2', bound(1, 1))).code).toBe('model-call-limit');
    expect(spentLimit(state, 'run-1', [ctx.principal])).toBe('model-calls');
  });

  it('is not a model call when it was a tool effect, so no call limit sees it', () => {
    const state = stateOf(tokenBudget, { maxModelCallsPerConversation: 1 });
    admit(state, 'fx', bound(30, 0), ctx, 'tool-effect');
    settle(state, { kind: 'not-dispatched', callId: 'fx' });
    admit(state, 'c1', bound(10, 10));
    expect(spentLimit(state, 'run-1', [ctx.principal])).toBe('model-calls');
    expect(budgetSpent(state.snapshot.usage, tokenBudget).tokens).toBe(20n);
  });

  it('is never priced, even when the policy would price its bound', () => {
    const state = stateOf(bothBudget);
    admit(state, 'c1');
    const priced: PricePolicy = { ...perToken, cost: () => usd('999') };
    applyCallSettlement(state, 2, ctx, { kind: 'not-dispatched', callId: 'c1' }, priced);
    expect(state.snapshot.usage[0]).toMatchObject({ price: { cost: null } });
    expect(recordCharge(state.snapshot.usage[0], bothBudget)).toEqual({ tokens: 0n, cost: 0n });
  });

  it('works without a budget', () => {
    const state = stateOf(null);
    reserveModelCall(state, 1, ctx, { callId: 'c1', providerId: 'p', modelId: 'm' });
    applyCallSettlement(state, 2, ctx, { kind: 'not-dispatched', callId: 'c1' });
    expect(state.snapshot.usage[0]).toMatchObject({
      outcome: 'not-dispatched',
      price: null,
      reservation: null,
    });
  });
});

describe('a call settled from the journal', () => {
  it('uses the reported usage through the ordinary settle path and provenance', () => {
    const state = stateOf(bothBudget);
    admit(state, 'c1');
    settle(state, { kind: 'settled', callId: 'c1', report: completed });
    expect(state.snapshot.usage[0]).toMatchObject({
      status: 'settled',
      outcome: 'completed',
      provenance: 'reported',
      tokens: { input: 7, output: 3 },
      price: { version: 'per-token', cost: usd('10') },
    });
    expect(budgetSpent(state.snapshot.usage, bothBudget)).toEqual({ tokens: 10n, cost: 10n });
  });

  it('keeps the bound when the journal usage is only partial', () => {
    const state = stateOf(tokenBudget);
    admit(state, 'c1');
    settle(state, {
      kind: 'settled',
      callId: 'c1',
      report: { ...completed, provenance: 'partial' },
    });
    expect(budgetSpent(state.snapshot.usage, tokenBudget).tokens).toBe(100n);
  });

  it('refuses a report that is not final, for another call, or an outcome only recovery writes', () => {
    const state = stateOf(tokenBudget);
    admit(state, 'c1');
    expect(
      refusal(() =>
        settle(state, { kind: 'settled', callId: 'c1', report: { ...completed, final: false } }),
      ).code,
    ).toBe('invalid-config');
    expect(
      refusal(() =>
        settle(state, { kind: 'settled', callId: 'c1', report: { ...completed, callId: 'x' } }),
      ).code,
    ).toBe('invalid-config');
    expect(
      refusal(() =>
        settle(state, {
          kind: 'settled',
          callId: 'c1',
          report: { ...completed, outcome: 'not-dispatched' as never },
        }),
      ).code,
    ).toBe('invalid-config');
    expect(state.snapshot.usage[0].status).toBe('reserved');
  });
});

describe('a call whose dispatch is uncertain', () => {
  it('keeps the bound counted and is a final, unknown record', () => {
    const state = stateOf(bothBudget);
    admit(state, 'c1');
    settle(state, { kind: 'uncertain', callId: 'c1' });
    expect(state.snapshot.usage[0]).toMatchObject({
      status: 'settled',
      outcome: 'failed',
      provenance: 'unknown',
      final: true,
    });
    expect(budgetSpent(state.snapshot.usage, bothBudget)).toEqual({ tokens: 100n, cost: 100n });
    expect(summarizeUsage(state.snapshot.usage)).toMatchObject({ unknownCalls: 1 });
  });

  it('can still be reconciled by the host but cannot be refunded by a second answer', () => {
    const state = stateOf(tokenBudget);
    admit(state, 'c1');
    settle(state, { kind: 'uncertain', callId: 'c1' });
    reconcileModelCall(state, 3, { callId: 'c1', tokens: 30 });
    expect(budgetSpent(state.snapshot.usage, tokenBudget).tokens).toBe(30n);
    state.snapshot.usage[0] = { ...state.snapshot.usage[0], reconciled: null };
    expect(refusal(() => settle(state, { kind: 'not-dispatched', callId: 'c1' })).code).toBe(
      'call-settled',
    );
    expect(budgetSpent(state.snapshot.usage, tokenBudget).tokens).toBe(100n);
  });
});

describe('a settlement that is refused', () => {
  it('refuses a call that belongs to another principal or attempt', () => {
    const state = stateOf(tokenBudget);
    admit(state, 'c1');
    const before = structuredClone(state.snapshot.usage);
    const other = { ...ctx, principal: { kind: 'participant' as const, id: 'b' } };
    expect(refusal(() => settle(state, { kind: 'not-dispatched', callId: 'c1' }, other)).code).toBe(
      'conflict',
    );
    const selector = { ...ctx, principal: { kind: 'selector' as const, id: 'a' } };
    expect(
      refusal(() => settle(state, { kind: 'not-dispatched', callId: 'c1' }, selector)).code,
    ).toBe('conflict');
    const attempt = { ...ctx, attemptId: 'attempt-2' };
    expect(refusal(() => settle(state, { kind: 'uncertain', callId: 'c1' }, attempt)).code).toBe(
      'conflict',
    );
    const room = { ...ctx, conversationId: 'elsewhere' };
    expect(
      refusal(() => settle(state, { kind: 'settled', callId: 'c1', report: completed }, room)).code,
    ).toBe('conflict');
    expect(state.snapshot.usage).toEqual(before);
  });

  it('refuses a call that is not in the ledger', () => {
    const state = stateOf(tokenBudget);
    expect(refusal(() => settle(state, { kind: 'not-dispatched', callId: 'ghost' })).code).toBe(
      'conflict',
    );
  });

  it.each<[string, CallSettlement]>([
    ['not-dispatched', { kind: 'not-dispatched', callId: 'c1' }],
    ['settled', { kind: 'settled', callId: 'c1', report: completed }],
    ['uncertain', { kind: 'uncertain', callId: 'c1' }],
  ])(
    'refuses a second %s answer with the typed error and applies nothing twice',
    (_label, second) => {
      for (const first of [
        { kind: 'not-dispatched', callId: 'c1' },
        { kind: 'settled', callId: 'c1', report: completed },
        { kind: 'uncertain', callId: 'c1' },
      ] as CallSettlement[]) {
        const state = stateOf(tokenBudget);
        admit(state, 'c1');
        settle(state, first);
        const stored = structuredClone(state.snapshot.usage);
        const error = refusal(() => settle(state, second));
        expect(error.code).toBe('call-settled');
        expect(state.snapshot.usage).toEqual(stored);
      }
    },
  );

  it('refuses a call already settled by an ordinary report', () => {
    const state = stateOf(tokenBudget);
    admit(state, 'c1');
    settle(state, { kind: 'settled', callId: 'c1', report: completed });
    expect(refusal(() => settle(state, { kind: 'not-dispatched', callId: 'c1' })).code).toBe(
      'call-settled',
    );
  });

  it('refuses a call the host already reconciled', () => {
    const state = stateOf(tokenBudget);
    admit(state, 'c1');
    state.snapshot.usage[0] = { ...state.snapshot.usage[0], reconciled: { tokens: 5, cost: null } };
    expect(refusal(() => settle(state, { kind: 'not-dispatched', callId: 'c1' })).code).toBe(
      'conflict',
    );
  });

  it.each([
    ['no call id', { kind: 'uncertain', callId: '' }],
    ['an unknown kind', { kind: 'refund', callId: 'c1' }],
    ['no value', undefined],
  ])('refuses %s', (_label, bad) => {
    const state = stateOf(tokenBudget);
    admit(state, 'c1');
    expect(refusal(() => settle(state, bad as unknown as CallSettlement)).code).toBe(
      'invalid-config',
    );
  });
});

describe('summaries of a ledger with recovered calls', () => {
  it('counts a not-dispatched model call as settled and not unknown, with no tokens or cost', () => {
    const state = stateOf(bothBudget);
    admit(state, 'c1');
    admit(state, 'c2', bound(10, 10));
    admit(state, 'fx', bound(5, 0), ctx, 'tool-effect');
    settle(state, { kind: 'not-dispatched', callId: 'c1' });
    settle(state, { kind: 'not-dispatched', callId: 'fx' });
    expect(summarizeUsage(state.snapshot.usage)).toEqual({
      totalCalls: 2,
      reservedCalls: 1,
      settledCalls: 1,
      unknownCalls: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
      cost: [],
      toolEffects: 1,
      notDispatchedCalls: 1,
    });
  });
});
