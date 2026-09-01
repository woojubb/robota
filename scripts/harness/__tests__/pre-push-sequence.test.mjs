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

import {
  createWorkRunMeasurementInput,
  prerequisitesFor,
  runPostVerdictGuard,
  runPrePushGate,
} from '../pre-push.mjs';
import { decidePrePushVerification, parsePrePushUpdates } from '../pre-push-updates.mjs';
import { createPrePushCommandRunner } from '../pre-push-command-runner.mjs';

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
      validateWorkRunMeasurement: record('validate-work-run-measurement', { ok: true }),
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
  it('asserts the tree prerequisites only AFTER deciding to verify', () => {
    const { order, steps } = recordingSteps(VERIFY);
    runPrePushGate(steps);
    expect(order).toEqual([
      'prune-worktrees',
      'clean-working-tree',
      'lockfile-consistency',
      'report-base-resolution',
      'decide-verification',
      'validate-work-run-measurement',
      'find-reusable-receipt',
      'tree-prerequisites',
      'run-verification',
    ]);
  });

  it('never places a build-output-reading step before the decision', () => {
    const { order, steps } = recordingSteps(VERIFY);
    runPrePushGate(steps);
    // Stated as an ordering invariant rather than an index, so it keeps its meaning if steps are
    // added around it: a prerequisite is owed only by work that is going to happen.
    expect(order.indexOf('tree-prerequisites')).toBeGreaterThan(
      order.indexOf('find-reusable-receipt'),
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
      'prune-worktrees',
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

  it('reuses exact full-gate evidence before demanding build prerequisites', () => {
    const { order, steps } = recordingSteps(VERIFY);
    steps.findReusableReceipt = () => {
      order.push('find-reusable-receipt');
      return { reusable: true, headCommit: 'abc123' };
    };

    expect(runPrePushGate(steps)).toEqual({
      verified: true,
      reused: true,
      reason: 'exact verify-like-ci receipt',
    });
    expect(order).toEqual([
      'prune-worktrees',
      'clean-working-tree',
      'lockfile-consistency',
      'report-base-resolution',
      'decide-verification',
      'validate-work-run-measurement',
      'find-reusable-receipt',
      'report-receipt-reused',
    ]);
  });

  it.each([
    ['verification', VERIFY, false],
    ['no-delta skip', SKIP_NO_DELTA, false],
    ['receipt reuse', VERIFY, true],
  ])('reports the resolved base exactly once on the %s path', (_label, decision, reusable) => {
    const { order, steps } = recordingSteps(decision);
    steps.findReusableReceipt = () => {
      order.push('find-reusable-receipt');
      return { reusable, headCommit: 'abc123' };
    };
    runPrePushGate(steps);
    expect(order.filter((step) => step === 'report-base-resolution')).toHaveLength(1);
  });

  it('refuses missing measurement before verification-receipt reuse', () => {
    const { order, steps } = recordingSteps(VERIFY);
    steps.validateWorkRunMeasurement = () => {
      order.push('validate-work-run-measurement');
      return { ok: false, reason: 'missing-measurement' };
    };
    expect(() => runPrePushGate(steps)).toThrow(/missing-measurement/);
    expect(order).not.toContain('find-reusable-receipt');
  });
});

describe('pre-push work-run subject', () => {
  it('passes already-resolved push identity into the shared range validator', () => {
    expect(
      createWorkRunMeasurementInput({
        root: '/repo',
        baseRef: 'origin/develop',
        pushSubject: {
          localObjectId: 'a'.repeat(40),
          localRef: 'refs/heads/codex/work',
          branch: 'codex/work',
        },
      }),
    ).toEqual({
      root: '/repo',
      baseRef: 'origin/develop',
      subjectRef: 'a'.repeat(40),
      subjectBranch: 'codex/work',
      prObservation: 'pre-push',
    });
  });

  it('refuses a branch label that does not match the resolved local ref', () => {
    expect(() =>
      createWorkRunMeasurementInput({
        root: '/repo',
        baseRef: 'origin/develop',
        pushSubject: {
          localObjectId: 'a'.repeat(40),
          localRef: 'refs/heads/codex/work',
          branch: 'codex/other',
        },
      }),
    ).toThrow(/local ref.*branch/i);
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

describe('the prerequisites a push owes follow the change classification (PROC-016)', () => {
  it('a harness-only or docs-only push owes install only — no build output', () => {
    expect(prerequisitesFor({ code: true, product: false, harness: true })).toEqual(['install']);
    expect(prerequisitesFor({ code: false, product: false })).toEqual(['install']);
  });

  it('a product-code push owes install AND build output', () => {
    expect(prerequisitesFor({ code: true, product: true })).toEqual(['install', 'build-output']);
  });

  it('an unclassifiable change owes everything — fail closed', () => {
    expect(prerequisitesFor(undefined)).toEqual(['install', 'build-output']);
    expect(prerequisitesFor({})).toEqual(['install', 'build-output']);
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
