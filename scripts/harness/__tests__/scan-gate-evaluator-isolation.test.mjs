import { describe, expect, it } from 'vitest';
import {
  commitIsolationFindings,
  examinedLine,
  evaluatorIsolationCommitFindings,
  evaluatorIsolationFindings,
} from '../scan-gate-evaluator-isolation.mjs';

describe('gate-evaluator-isolation', () => {
  it('rejects evaluator and evidence changes in one diff', () => {
    expect(
      evaluatorIsolationFindings([
        'scripts/harness/gate-criteria.mjs',
        '.agents/spec-docs/active/RULE-025.md',
      ]),
    ).toHaveLength(1);
  });

  it('allows evidence changes without evaluator changes', () => {
    expect(evaluatorIsolationFindings(['.agents/spec-docs/active/RULE-025.md'])).toEqual([]);
  });

  it('allows evaluator and evidence changes in separate commits', () => {
    expect(
      evaluatorIsolationCommitFindings([
        { sha: 'aaaaaaaaa', paths: ['scripts/harness/gate-operations.mjs'] },
        { sha: 'bbbbbbbbb', paths: ['.agents/spec-docs/active/RULE-025.md'] },
      ]),
    ).toEqual([]);
  });

  it('explains an empty diff as expected when no paths are available to inspect', () => {
    expect(examinedLine(0)).toContain(
      '::examined:: 0 changed path(s) ::expected-empty:: HEAD is the merge base',
    );
  });
});

describe('the unit of "the same diff" is a commit, not a branch range (issue #2610)', () => {
  // The scan's own sentence is "edits a gate evaluator and records evaluated gate evidence in the
  // SAME DIFF". A commit is a diff; a branch range is a series of them. Reading the range as one diff
  // makes the scan's own remedy — "file the evaluator defect as a separate item" — unreachable, because
  // every item's planning checkpoint is spec evidence and must be an ancestor of its implementation.
  it('refuses a single commit that mixes an evaluator with gate evidence', () => {
    expect(
      commitIsolationFindings([
        {
          commit: 'abc1234',
          paths: ['scripts/harness/gate-criteria.mjs', '.agents/spec-docs/active/RULE-025.md'],
        },
      ]),
    ).toHaveLength(1);
  });

  it('permits a checkpoint commit followed by an evaluator commit', () => {
    expect(
      commitIsolationFindings([
        { commit: 'aaa1111', paths: ['.agents/spec-docs/active/RULE-025.md'] },
        { commit: 'bbb2222', paths: ['scripts/harness/gate-operations.mjs'] },
      ]),
    ).toEqual([]);
  });

  it('names the offending commit, so the reader knows which one to split', () => {
    const findings = commitIsolationFindings([
      { commit: 'aaa1111', paths: ['.agents/spec-docs/active/RULE-025.md'] },
      {
        commit: 'ccc3333',
        paths: ['.claude/hooks/intake-guard.sh', '.agents/spec-docs/todo/X.md'],
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('ccc3333');
  });

  it('still refuses when a merge commit itself carries both', () => {
    expect(
      commitIsolationFindings([
        { commit: 'ddd4444', paths: ['scripts/harness/gate-criteria.mjs', '.agents/spec-docs/todo/Y.md'] },
        { commit: 'eee5555', paths: ['README.md'] },
      ]),
    ).toHaveLength(1);
  });
});
