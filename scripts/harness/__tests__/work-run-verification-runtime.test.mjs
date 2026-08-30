import { describe, expect, it, vi } from 'vitest';

import {
  createWorkRunVerificationRuntime,
  takeWorkRunVerificationCommand,
  takeWorkRunVerificationQuery,
} from '../work-run-verification-runtime.mjs';
import { MAX_RANGE_COMMITS, MAX_RANGE_RECEIPTS } from '../work-run-validation-foundation.mjs';

describe('work-run verification runtime', () => {
  it('budgets every supported historical commit and receipt query at the upper bounds', () => {
    const runtime = createWorkRunVerificationRuntime();

    expect(runtime.remaining).toBeGreaterThanOrEqual(
      MAX_RANGE_COMMITS * 2 + MAX_RANGE_RECEIPTS + 32,
    );
  });

  it('shares one deterministic deadline across command and query budgets', () => {
    const runtime = createWorkRunVerificationRuntime({
      now: () => 1_000,
      timeoutMs: 250,
      commandBudget: 1,
      queryBudget: 1,
    });

    expect(takeWorkRunVerificationCommand(runtime)).toBe(250);
    expect(takeWorkRunVerificationQuery(runtime)).toBe(250);
    expect(() => takeWorkRunVerificationCommand(runtime)).toThrow(
      'work-run verification command budget exhausted',
    );
    expect(() => takeWorkRunVerificationQuery(runtime)).toThrow(
      'work-run verification query budget exhausted',
    );
  });

  it('fails before invoking an operation after the shared deadline expires', () => {
    const now = vi.fn(() => 2_001);
    const runtime = createWorkRunVerificationRuntime({
      now,
      startedAt: 2_000,
      timeoutMs: 1,
      commandBudget: 10,
      queryBudget: 10,
    });

    expect(() => takeWorkRunVerificationCommand(runtime)).toThrow(
      'work-run verification deadline exhausted',
    );
    expect(runtime.commandsRemaining).toBe(10);
    expect(runtime.remaining).toBe(10);
  });
});
