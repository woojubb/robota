import { describe, expect, it } from 'vitest';

import { subagentExecutionRoot } from '../execution-root.js';

import type { ISubagentExecutionEnvelope } from '../execution-root.js';

/**
 * ARCH-010 — which directory a spawned subagent actually runs in.
 *
 * This is where the audit's measured breach was: neither runner read `request.cwd`, so both children
 * fell back to `process.cwd()` — the parent's directory — and their file tools, built with no
 * containment root, had no boundary at all. A subagent `Read` of `/etc/hostname` returned the file.
 *
 * The type now FORCES a root at both call sites, but a type cannot force the RIGHT one: a regression
 * to `process.cwd()` here would compile and every existing test would stay green. That is what these
 * cases are for, and why the rule lives in one function rather than being written out at each runner.
 */
/**
 * ARCH-031: the envelope, not the request. The worktree is runner-PRODUCED — it does not exist when a
 * caller builds a request — so it rides beside the request rather than on it, and the runner no longer
 * rewrites `request.cwd` to the same path (two carriers for one rule could disagree).
 */
function envelope(cwd: string, worktreePath?: string): ISubagentExecutionEnvelope {
  return {
    request: { cwd },
    ...(worktreePath !== undefined ? { worktree: { path: worktreePath } } : {}),
  };
}

describe('subagentExecutionRoot (ARCH-010)', () => {
  it('uses the request cwd — never the process directory', () => {
    // The defect in one line: both runners produced the parent's directory here.
    expect(subagentExecutionRoot(envelope('/some/workspace'))).toBe('/some/workspace');
    expect(subagentExecutionRoot(envelope('/some/workspace'))).not.toBe(process.cwd());
  });

  it('prefers the WORKTREE when the job is worktree-isolated', () => {
    // Isolating a subagent into a worktree and then running it in the parent's checkout would defeat
    // the isolation entirely — the worktree is the point.
    const root = subagentExecutionRoot(envelope('/parent/checkout', '/tmp/wt/job-1'));
    expect(root).toBe('/tmp/wt/job-1');
  });

  it('falls back to cwd when there is no worktree — not to anything ambient', () => {
    expect(subagentExecutionRoot(envelope('/parent/checkout'))).toBe('/parent/checkout');
  });
});
