import { describe, expect, it } from 'vitest';

import { subagentExecutionRoot } from '../execution-root.js';

import type { ISubagentSpawnRequest } from '../types.js';

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
function request(overrides: Partial<ISubagentSpawnRequest>): ISubagentSpawnRequest {
  return {
    type: 'general-purpose',
    label: 'test',
    parentSessionId: 'parent',
    mode: 'sync',
    depth: 1,
    cwd: '/parent/checkout',
    prompt: 'do the thing',
    ...overrides,
  } as ISubagentSpawnRequest;
}

describe('subagentExecutionRoot (ARCH-010)', () => {
  it('uses the request cwd — never the process directory', () => {
    // The defect in one line: both runners produced the parent's directory here.
    expect(subagentExecutionRoot(request({ cwd: '/some/workspace' }))).toBe('/some/workspace');
    expect(subagentExecutionRoot(request({ cwd: '/some/workspace' }))).not.toBe(process.cwd());
  });

  it('prefers the WORKTREE when the job is worktree-isolated', () => {
    // Isolating a subagent into a worktree and then running it in the parent's checkout would defeat
    // the isolation entirely — the worktree is the point.
    const root = subagentExecutionRoot(
      request({ cwd: '/parent/checkout', worktreePath: '/tmp/wt/job-1' }),
    );
    expect(root).toBe('/tmp/wt/job-1');
  });

  it('falls back to cwd when there is no worktree — not to anything ambient', () => {
    expect(subagentExecutionRoot(request({ worktreePath: undefined }))).toBe('/parent/checkout');
  });
});
