import { describe, expect, it } from 'vitest';

import {
  planSelfHostingVerification,
  transitionSelfHostingLoop,
} from '../self-hosting-verification';

import type { ISelfHostingCommandTemplates } from '../self-hosting-verification';

/**
 * NEUT-001: the library ships no repo-specific commands — tests inject a neutral
 * template set the way a composition root would (Robota's real templates live in
 * `scripts/harness/self-hosting-verification-commands.mjs`).
 */
const COMMAND_TEMPLATES: ISelfHostingCommandTemplates = {
  packageVerify: [
    { name: 'test', template: 'run-verify {scope} test' },
    { name: 'typecheck', template: 'run-verify {scope} typecheck' },
    { name: 'build', template: 'run-verify {scope} build' },
  ],
  repoVerify: {
    description: 'Run the repository-wide verification gate.',
    template: 'run-repo-verify --base-ref {baseRef}',
  },
};

describe('planSelfHostingVerification', () => {
  it('Given changed package scopes When planning verification Then checkpoint, atomic edit, child-process handoff, package checks, and the repo gate are ordered', () => {
    const plan = planSelfHostingVerification({
      changedFiles: ['packages/agent-sdk/src/index.ts'],
      packageScopes: ['@example/pkg'],
      baseRef: 'origin/main',
      commandTemplates: COMMAND_TEMPLATES,
    });

    expect(plan.steps.map((step) => step.id)).toEqual([
      'checkpoint',
      'atomic-edit',
      'handoff',
      'package-test:@example/pkg',
      'package-typecheck:@example/pkg',
      'package-build:@example/pkg',
      'repo-verify',
      'rollback-on-failure',
    ]);
    expect(plan.steps.find((step) => step.id === 'repo-verify')?.command).toBe(
      'run-repo-verify --base-ref origin/main',
    );
    expect(plan.steps.find((step) => step.id === 'package-test:@example/pkg')?.command).toBe(
      'run-verify @example/pkg test',
    );
  });

  it('Given no package scopes When planning verification Then the repo gate remains mandatory', () => {
    const plan = planSelfHostingVerification({
      changedFiles: ['README.md'],
      baseRef: 'origin/main',
      commandTemplates: COMMAND_TEMPLATES,
    });

    expect(plan.steps.map((step) => step.id)).toContain('repo-verify');
    expect(plan.steps.some((step) => step.id.startsWith('package-'))).toBe(false);
  });

  it('Given no repoVerify template When planning verification Then no repo gate step is emitted', () => {
    const plan = planSelfHostingVerification({
      changedFiles: ['README.md'],
      baseRef: 'origin/main',
      commandTemplates: { packageVerify: COMMAND_TEMPLATES.packageVerify },
    });

    expect(plan.steps.map((step) => step.id)).not.toContain('repo-verify');
  });

  it('Given no changed files When planning verification Then it rejects the invalid loop', () => {
    expect(() =>
      planSelfHostingVerification({
        changedFiles: [],
        baseRef: 'origin/main',
        commandTemplates: COMMAND_TEMPLATES,
      }),
    ).toThrow('requires at least one changed file');
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
