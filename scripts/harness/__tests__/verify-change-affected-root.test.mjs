import { describe, expect, it } from 'vitest';

import {
  createRootVerificationCommands,
  shouldUseFullRootVerification,
} from '../verify-change.mjs';

function options(overrides = {}) {
  return {
    scopeTokens: [],
    baseRef: 'origin/develop',
    skipBuild: false,
    skipTests: false,
    skipLint: false,
    skipTypecheck: false,
    ...overrides,
  };
}

function plan(overrides = {}) {
  return {
    workspaceWideTriggers: [],
    workspaceScopeCount: 100,
    scopes: [
      {
        scope: 'packages/agent-core',
        checks: ['build', 'test', 'lint', 'typecheck'],
      },
    ],
    ...overrides,
  };
}

describe('createRootVerificationCommands', () => {
  it('runs every enabled scoped operation once through its affected root command', () => {
    expect(
      createRootVerificationCommands({ plan: plan(), options: options(), environment: {} }),
    ).toEqual([
      {
        check: 'build',
        mode: 'affected',
        command: 'pnpm',
        args: ['build:affected', '--', '--base-ref', 'origin/develop'],
      },
      {
        check: 'test',
        mode: 'affected',
        command: 'pnpm',
        args: ['test:affected', '--', '--base-ref', 'origin/develop'],
      },
      {
        check: 'lint',
        mode: 'affected',
        command: 'pnpm',
        args: ['lint:affected', '--', '--base-ref', 'origin/develop'],
      },
      {
        check: 'typecheck',
        mode: 'affected',
        command: 'pnpm',
        args: ['typecheck:affected', '--', '--base-ref', 'origin/develop'],
      },
    ]);
  });

  it('forwards explicit scope filters and honors disabled checks', () => {
    const commands = createRootVerificationCommands({
      plan: plan(),
      options: options({ scopeTokens: ['packages/agent-core'], skipTests: true, skipLint: true }),
      environment: {},
    });

    expect(commands.map((command) => command.check)).toEqual(['build', 'typecheck']);
    expect(commands[0].args).toEqual([
      'build:affected',
      '--',
      '--base-ref',
      'origin/develop',
      '--scope',
      'packages/agent-core',
    ]);
  });

  it('uses full scripts for workspace control-plane and release verification', () => {
    const controlPlanePlan = plan({
      workspaceWideTriggers: ['scripts/build-types-ordered.mjs'],
      scopes: Array.from({ length: 100 }, (_, index) => ({
        scope: `packages/p${index}`,
        checks: ['build', 'test', 'lint', 'typecheck'],
      })),
    });
    const commands = createRootVerificationCommands({
      plan: controlPlanePlan,
      options: options(),
      environment: {},
    });

    expect(commands.map((command) => command.args)).toEqual([
      ['build'],
      ['test'],
      ['lint'],
      ['typecheck'],
    ]);
    expect(shouldUseFullRootVerification(plan(), options(), { RELEASE_VERIFICATION: '1' })).toBe(
      true,
    );
  });
});
