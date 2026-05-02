import { describe, expect, it } from 'vitest';
import {
  planSelfHostingVerification,
  transitionSelfHostingLoop,
} from '../self-hosting-verification';

describe('planSelfHostingVerification', () => {
  it('Given changed package scopes When planning verification Then checkpoint, atomic edit, child-process handoff, package checks, and harness verification are ordered', () => {
    const plan = planSelfHostingVerification({
      changedFiles: ['packages/agent-sdk/src/index.ts'],
      packageScopes: ['@robota-sdk/agent-sdk'],
      baseRef: 'origin/develop',
    });

    expect(plan.steps.map((step) => step.id)).toEqual([
      'checkpoint',
      'atomic-edit',
      'handoff',
      'package-test:@robota-sdk/agent-sdk',
      'package-typecheck:@robota-sdk/agent-sdk',
      'package-build:@robota-sdk/agent-sdk',
      'harness-verify',
      'rollback-on-failure',
    ]);
    expect(plan.steps.find((step) => step.id === 'harness-verify')?.command).toBe(
      'pnpm harness:verify -- --base-ref origin/develop --skip-record-check',
    );
  });

  it('Given no package scopes When planning verification Then harness verification remains mandatory', () => {
    const plan = planSelfHostingVerification({
      changedFiles: ['README.md'],
    });

    expect(plan.steps.map((step) => step.id)).toContain('harness-verify');
    expect(plan.steps.some((step) => step.command?.includes('pnpm --filter'))).toBe(false);
  });

  it('Given no changed files When planning verification Then it rejects the invalid loop', () => {
    expect(() => planSelfHostingVerification({ changedFiles: [] })).toThrow(
      'requires at least one changed file',
    );
  });
});

describe('transitionSelfHostingLoop', () => {
  it('Given the happy path events When transitioning Then the loop reaches passed', () => {
    let state = transitionSelfHostingLoop('idle', 'checkpoint_created');
    state = transitionSelfHostingLoop(state, 'edits_started');
    state = transitionSelfHostingLoop(state, 'edits_applied');
    state = transitionSelfHostingLoop(state, 'verify_passed');

    expect(state).toBe('passed');
  });

  it('Given verification fails When rollback completes Then the loop reaches rolled_back', () => {
    let state = transitionSelfHostingLoop('idle', 'checkpoint_created');
    state = transitionSelfHostingLoop(state, 'edits_started');
    state = transitionSelfHostingLoop(state, 'edits_applied');
    state = transitionSelfHostingLoop(state, 'verify_failed');
    state = transitionSelfHostingLoop(state, 'rollback_completed');

    expect(state).toBe('rolled_back');
  });

  it('Given an impossible event When transitioning Then it rejects the transition', () => {
    expect(() => transitionSelfHostingLoop('idle', 'verify_passed')).toThrow(
      'Invalid self-hosting loop transition',
    );
  });
});
