/**
 * HARNESS-058 (second face) — the pre-push gate must not demand a prerequisite for work it has
 * already decided not to do.
 *
 * The defect: `assertTreePrerequisites` ran third, before `decidePrePushVerification` decided
 * whether anything would be verified at all. Two kinds of push verify nothing — a delete-only push,
 * and a re-push whose tree has no content delta from its base — and neither reads `node_modules` or
 * `dist`. Measured in a fresh worktree, both were refused with "run `pnpm install && pnpm build`"
 * for a push with nothing to check, in exactly the parallel-subagent configuration the item serves.
 *
 * These assert the SEQUENCE, not only the two cases. A test that checked only "a delete-only push is
 * allowed" would go green again the moment someone moved the assertion back ahead of the decision
 * for an unrelated reason, because a tree that happens to be prepared passes either way. What is
 * pinned here is that no step which reads build output runs before the decision that makes it
 * relevant.
 */

import { describe, expect, it, vi } from 'vitest';

// harness-coverage: pre-push-verification-execution.mjs
// harness-coverage: pre-push-command-runner.mjs

import {
  createPrePushSteps,
  prerequisitesFor,
  runPostVerdictGuard,
  runPrePushGate,
} from '../pre-push.mjs';
import { createPrePushCommandRunner } from '../pre-push-command-runner.mjs';
import { runPrePushVerification } from '../pre-push-verification-execution.mjs';
import { decidePrePushVerification, parsePrePushUpdates } from '../pre-push-updates.mjs';

/** Steps that record their own names instead of touching git, pnpm or the filesystem. */
function recordingSteps(decision) {
  const order = [];
  const record =
    (name, result) =>
    (...args) => {
      order.push(name);
      return typeof result === 'function' ? result(...args) : result;
    };
  return {
    order,
    steps: {
      pruneAndWarnStaleWorktrees: record('prune-worktrees'),
      assertCleanWorkingTree: record('clean-working-tree'),
      assertLockfileConsistency: record('lockfile-consistency'),
      reportBaseResolution: record('report-base-resolution'),
      decideVerification: record('decide-verification', decision),
      findReusableReceipt: record('find-reusable-receipt', { reusable: false }),
      reportReceiptReused: record('report-receipt-reused'),
      reportSkipped: record('report-skipped'),
      assertTreePrerequisites: record('tree-prerequisites'),
      runVerification: record('run-verification'),
    },
  };
}

const SKIP_DELETE_ONLY = { shouldRun: false, reason: 'delete-only push' };
const SKIP_NO_DELTA = { shouldRun: false, reason: 'no content delta from origin/develop' };
const VERIFY = { shouldRun: true, reason: null };

describe('runPrePushGate step order', () => {
  it.each([
    'assertCleanWorkingTree',
    'assertLockfileConsistency',
    'decideVerification',
    'assertTreePrerequisites',
    'runVerification',
  ])('does not swallow failure from %s', (failingStep) => {
    const { order, steps } = recordingSteps(VERIFY);
    steps[failingStep] = () => {
      order.push('failed');
      throw new Error(failingStep);
    };
    expect(() => runPrePushGate(steps)).toThrow(failingStep);
    expect(order.at(-1)).toBe('failed');
    expect(order).not.toContain('run-verification');
    expect(order).not.toContain('report-skipped');
  });

  it('LOCAL-2655 runs local checks without pruning worktrees or consulting full receipts', () => {
    const { order, steps } = recordingSteps(VERIFY);
    steps.findReusableReceipt = () => {
      order.push('find-reusable-receipt');
      return { reusable: true, headCommit: 'abc123' };
    };

    expect(runPrePushGate(steps)).toEqual({ verified: true, reason: null });
    expect(order).toEqual([
      'clean-working-tree',
      'lockfile-consistency',
      'report-base-resolution',
      'decide-verification',
      'tree-prerequisites',
      'run-verification',
    ]);
  });

  it('asserts the tree prerequisites only AFTER deciding to verify', () => {
    const { order, steps } = recordingSteps(VERIFY);
    runPrePushGate(steps);
    expect(order).toEqual([
      'clean-working-tree',
      'lockfile-consistency',
      'report-base-resolution',
      'decide-verification',
      'tree-prerequisites',
      'run-verification',
    ]);
  });

  it('never checks install prerequisites before the decision', () => {
    const { order, steps } = recordingSteps(VERIFY);
    runPrePushGate(steps);
    // Stated as an ordering invariant rather than an index, so it keeps its meaning if steps are
    // added around it: a prerequisite is owed only by work that is going to happen.
    expect(order.indexOf('tree-prerequisites')).toBeGreaterThan(
      order.indexOf('decide-verification'),
    );
    expect(order.indexOf('tree-prerequisites')).toBeLessThan(order.indexOf('run-verification'));
  });

  it.each([
    ['delete-only push', SKIP_DELETE_ONLY],
    ['no content delta', SKIP_NO_DELTA],
  ])('does not assert tree prerequisites when the decision is to skip (%s)', (_label, decision) => {
    const { order, steps } = recordingSteps(decision);
    const result = runPrePushGate(steps);
    expect(order).toEqual([
      'clean-working-tree',
      'lockfile-consistency',
      'report-base-resolution',
      'decide-verification',
      'report-skipped',
    ]);
    expect(order).not.toContain('tree-prerequisites');
    expect(order).not.toContain('run-verification');
    expect(result).toEqual({ verified: false, reason: decision.reason });
  });

  it('reports the skip reason it was given, so the push says why it verified nothing', () => {
    const reported = [];
    const { steps } = recordingSteps(SKIP_NO_DELTA);
    steps.reportSkipped = (reason) => reported.push(reason);
    runPrePushGate(steps);
    expect(reported).toEqual(['no content delta from origin/develop']);
  });

  it('reports a verified run', () => {
    const { steps } = recordingSteps(VERIFY);
    expect(runPrePushGate(steps)).toEqual({ verified: true, reason: null });
  });

  it.each([
    ['verification', VERIFY, false],
    ['no-delta skip', SKIP_NO_DELTA, false],
    ['legacy receipt available', VERIFY, true],
  ])('reports the resolved base exactly once on the %s path', (_label, decision, reusable) => {
    const { order, steps } = recordingSteps(decision);
    steps.findReusableReceipt = () => {
      order.push('find-reusable-receipt');
      return { reusable, headCommit: 'abc123' };
    };
    runPrePushGate(steps);
    expect(order.filter((step) => step === 'report-base-resolution')).toHaveLength(1);
  });
});

/**
 * The sequence test above uses a stubbed decision, so these connect it to the REAL predicate: the
 * two skip reasons are the ones `decidePrePushVerification` actually produces from real hook stdin.
 * Without this pairing the ordering test could pin a decision shape nothing ever returns.
 */
describe('the real decision reaches the gate as a skip', () => {
  const ZERO = '0'.repeat(40);
  const SHA = 'a'.repeat(40);

  const gateFor = (input, { baseRef, treeMatchesBase }) => {
    const decision = decidePrePushVerification({
      updates: parsePrePushUpdates(input),
      baseRef,
      treeMatchesBase,
    });
    const { order, steps } = recordingSteps(decision);
    const result = runPrePushGate(steps);
    return { order, result, decision };
  };

  it('a real delete-only hook line skips verification and asserts no prerequisite', () => {
    const { order, result } = gateFor(`(delete) ${ZERO} refs/heads/gone ${SHA}\n`, {
      baseRef: 'origin/develop',
      treeMatchesBase: false,
    });
    expect(result).toEqual({ verified: false, reason: 'delete-only push' });
    expect(order).not.toContain('tree-prerequisites');
  });

  it('a real no-delta re-push skips verification and asserts no prerequisite', () => {
    const { order, result } = gateFor(`refs/heads/x ${SHA} refs/heads/x ${ZERO}\n`, {
      baseRef: 'origin/develop',
      treeMatchesBase: true,
    });
    expect(result).toEqual({ verified: false, reason: 'no content delta from origin/develop' });
    expect(order).not.toContain('tree-prerequisites');
  });

  it('a real push WITH a delta still reaches the prerequisite assertion', () => {
    const { order, result } = gateFor(`refs/heads/x ${SHA} refs/heads/x ${ZERO}\n`, {
      baseRef: 'origin/develop',
      treeMatchesBase: false,
    });
    expect(result).toEqual({ verified: true, reason: null });
    expect(order).toContain('tree-prerequisites');
  });
});

describe('pre-push prerequisites follow its local work, not the product change classification', () => {
  it('a harness-only or docs-only push owes install only — no build output', () => {
    expect(prerequisitesFor({ code: true, product: false, harness: true })).toEqual(['install']);
    expect(prerequisitesFor({ code: false, product: false })).toEqual(['install']);
  });

  it('LOCAL-2655 a product-code push owes install only for local formatting', () => {
    expect(prerequisitesFor({ code: true, product: true })).toEqual(['install']);
  });

  it('an unclassifiable change still owes install, but no unused product build', () => {
    expect(prerequisitesFor(undefined)).toEqual(['install']);
    expect(prerequisitesFor({})).toEqual(['install']);
  });
});

describe('post-verdict guard reaches the real Git pre-push boundary', () => {
  it('refuses when the shared agent guard returns a non-zero status', () => {
    const result = runPostVerdictGuard({
      cwd: '/tmp/fixture-repo',
      script: '/tmp/fixture-repo/.claude/hooks/pre-push-check.sh',
      spawn(_command, _args, options) {
        expect(JSON.parse(options.input)).toMatchObject({
          tool_name: 'Bash',
          tool_input: { command: 'git push' },
        });
        return { status: 2 };
      },
    });
    expect(result).toBe(false);
  });

  it('allows only an explicit zero exit from the shared guard', () => {
    expect(
      runPostVerdictGuard({
        spawn: () => ({ status: 0 }),
      }),
    ).toBe(true);
  });
});

describe('pre-push command runner characterization (INFRA-148)', () => {
  it('renders the command and preserves the existing child-process contract', () => {
    const writes = [];
    const spawn = vi.fn(() => ({ status: 0 }));
    const run = createPrePushCommandRunner({
      root: '/tmp/repository',
      spawn,
      write: (value) => writes.push(value),
    });

    run('pnpm', ['harness:scan']);

    expect(writes).toEqual(['> pnpm harness:scan\n']);
    expect(spawn).toHaveBeenCalledWith('pnpm', ['harness:scan'], {
      cwd: '/tmp/repository',
      stdio: 'inherit',
      encoding: 'utf8',
    });
  });

  it('forwards a non-zero child status to the existing exit boundary', () => {
    const exit = vi.fn();
    const run = createPrePushCommandRunner({
      root: '/tmp/repository',
      spawn: () => ({ status: 7 }),
      write: () => {},
      exit,
    });

    run('pnpm', ['harness:scan']);

    expect(exit).toHaveBeenCalledWith(7);
  });
});

describe('LOCAL-2655 local pre-push execution', () => {
  it('keeps unresolved-base formatting on checkout changes instead of a diagnostic default base', () => {
    const calls = [];
    const writes = [];
    runPrePushVerification(
      { baseRef: null, baseArgs: [], scopeExpansionArgs: [], prePushMode: 'full' },
      { run: (command, args) => calls.push([command, args]), write: (value) => writes.push(value) },
    );
    expect(calls).toEqual([
      ['pnpm', ['harness:plan', '--']],
      ['pnpm', ['harness:verify-like-ci', '--', '--base-ref', 'HEAD', '--only', 'format-check']],
    ]);
    expect(writes.join('')).toContain('base: unresolved; using working-tree changes only');
  });

  it('wires only planning and formatting, even for a full product-code push', () => {
    const calls = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const steps = createPrePushSteps({
        runtime: {
          baseRef: 'origin/develop',
          baseArgs: ['--base-ref', 'origin/develop'],
          basePlan: { classificationBaseRef: 'origin/develop' },
          scopeExpansionArgs: [],
          prePushMode: 'full',
          subjectRef: 'a'.repeat(40),
          changeClassification: { code: true, product: true, harness: true },
        },
        createCommandRunner: () => (command, args) => calls.push([command, args]),
      });

      steps.runVerification();

      expect(calls).toEqual([
        ['pnpm', ['harness:plan', '--', '--base-ref', 'origin/develop']],
        [
          'pnpm',
          [
            'harness:verify-like-ci',
            '--',
            '--base-ref',
            'origin/develop',
            '--only',
            'format-check',
          ],
        ],
      ]);
      expect(steps).not.toHaveProperty('findReusableReceipt');
      expect(steps).not.toHaveProperty('reportReceiptReused');
      expect(steps).not.toHaveProperty('pruneAndWarnStaleWorktrees');
      const output = write.mock.calls.map(([value]) => value).join('');
      expect(output).toContain('Local checks passed: planning, formatting');
      expect(output).toContain('not CI-equivalent');
      expect(output).toContain(
        'CI-owned (not run locally): repository-contract, hermetic, pristine',
      );
      expect(output).toContain('Manual (not run by pre-push): focused changed-code tests');
    } finally {
      write.mockRestore();
    }
  });

  it.each(['harness:plan', 'harness:verify-like-ci'])(
    'propagates a failing %s without claiming local success',
    (failingScript) => {
      const calls = [];
      const writes = [];
      expect(() =>
        runPrePushVerification(
          {
            baseRef: 'origin/develop',
            baseArgs: ['--base-ref', 'origin/develop'],
            scopeExpansionArgs: ['--skip-dependent-scopes'],
            prePushMode: 'fast',
          },
          {
            write: (value) => writes.push(value),
            run: (command, args) => {
              calls.push([command, args]);
              if (args[0] === failingScript) throw new Error('local check failed');
            },
          },
        ),
      ).toThrow('local check failed');
      expect(calls.map(([, args]) => args[0])).toEqual(
        failingScript === 'harness:plan'
          ? ['harness:plan']
          : ['harness:plan', 'harness:verify-like-ci'],
      );
      expect(writes.join('')).not.toContain('Local checks passed');
      expect(calls[0][1]).toContain('--skip-dependent-scopes');
      if (calls.length === 2) expect(calls[1][1]).not.toContain('--skip-dependent-scopes');
    },
  );
});
