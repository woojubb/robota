/*
 * Issue #2412 — `resolveHeadSha`, the head-side sibling of `resolveBaseRef`.
 *
 * Which commit a pull_request-event history scan evaluates had no owner: each per-commit consumer
 * patched the merge-ref trap differently. One resolver, and a refusal — never a fallback — when
 * the only head available is GitHub's synthetic `refs/pull/N/merge`.
 */

import { describe, expect, it } from 'vitest';

import { resolveHeadSha } from '../shared.mjs';

describe('resolveHeadSha (issue #2412)', () => {
  it('reads PR_HEAD_SHA first, then GITHUB_PR_HEAD_SHA', () => {
    expect(resolveHeadSha({ env: { PR_HEAD_SHA: 'abc123' } })).toEqual({
      head: 'abc123',
      error: undefined,
    });
    expect(resolveHeadSha({ env: { GITHUB_PR_HEAD_SHA: 'def456' } }).head).toBe('def456');
  });

  it('lets an explicit `--head` win over the environment', () => {
    expect(resolveHeadSha({ argv: ['--head', 'feed1'], env: { PR_HEAD_SHA: 'abc123' } }).head).toBe(
      'feed1',
    );
  });

  it('refuses a valueless `--head`', () => {
    expect(resolveHeadSha({ argv: ['--head'], env: {} }).error).toMatch(/no value/);
    expect(resolveHeadSha({ argv: ['--head', '--other'], env: {} }).error).toMatch(/no value/);
  });

  it('THE TRAP: refuses to fall back to HEAD under a pull_request event', () => {
    const result = resolveHeadSha({ env: { GITHUB_EVENT_NAME: 'pull_request' } });
    expect(result.head).toBeUndefined();
    expect(result.error).toMatch(/refs\/pull\/N\/merge/);
    expect(
      resolveHeadSha({ env: { GITHUB_EVENT_NAME: 'pull_request_target' } }).error,
    ).toBeTruthy();
  });

  it('refuses the merge ref even when it is handed over explicitly', () => {
    expect(resolveHeadSha({ env: { PR_HEAD_SHA: 'refs/pull/42/merge' } }).error).toMatch(
      /synthetic merge ref/,
    );
  });

  it('falls back to HEAD outside a pull_request event (a push, a local run)', () => {
    expect(resolveHeadSha({ env: { GITHUB_EVENT_NAME: 'push' } })).toEqual({
      head: 'HEAD',
      error: undefined,
    });
    expect(resolveHeadSha({ env: {} }).head).toBe('HEAD');
  });

  it('treats a blank PR_HEAD_SHA as absent — the env key set to nothing is not a head', () => {
    expect(
      resolveHeadSha({ env: { PR_HEAD_SHA: '  ', GITHUB_EVENT_NAME: 'pull_request' } }).error,
    ).toBeTruthy();
  });
});
