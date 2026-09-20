/** BEHAVIOR-2437 TC-01 — `/git status`: one porcelain-v2 call, parsed into the four groups. */
import { describe, expect, it } from 'vitest';

import { executeGitStatus, formatGitStatus, parseStatusPorcelainV2 } from '../git-status.js';

import { exited, fakeGitPort } from './fake-git-port.js';

const H = '0000000000000000000000000000000000000000';
const rec = (parts: string[]): string => `${parts.join(' ')}\0`;
/** Captured from a real `git status --porcelain=v2 -z --branch` run, plus the edge paths. */
const FIXTURE =
  rec(['#', 'branch.oid', H]) +
  rec(['#', 'branch.head', 'main']) +
  rec(['1', 'MM', 'N...', '100644', '100644', '100644', H, H, 'a.txt']) +
  rec(['2', 'R.', 'N...', '100644', '100644', '100644', H, H, 'R100', 'new.txt']) +
  'old.txt\0' +
  rec(['1', '.M', 'N...', '100644', '100644', '100644', H, H, 'sp ace.txt']) +
  rec(['1', 'A.', 'N...', '000000', '100644', '100644', H, H, 'quo"te.txt']) +
  rec(['1', 'A.', 'N...', '000000', '100644', '100644', H, H, '한글 파일.txt']) +
  rec(['?', 'untracked.txt']);

describe('parseStatusPorcelainV2', () => {
  it('yields the branch and the staged, unstaged and untracked sets, one element per path', () => {
    const summary = parseStatusPorcelainV2(FIXTURE);
    expect(summary.branch).toBe('main');
    expect(summary.unborn).toBe(false);
    // The MM entry is in BOTH sets; the rename pair stays a pair; each edge path is one element.
    expect(summary.staged).toEqual([
      'a.txt',
      'new.txt (from old.txt)',
      'quo"te.txt',
      '한글 파일.txt',
    ]);
    expect(summary.unstaged).toEqual(['a.txt', 'sp ace.txt']);
    expect(summary.untracked).toEqual(['untracked.txt']);
    expect(summary.conflicted).toEqual([]);
  });

  it('reads an unborn branch and a detached HEAD', () => {
    expect(
      parseStatusPorcelainV2(
        rec(['#', 'branch.oid', '(initial)']) + rec(['#', 'branch.head', 'main']),
      ),
    ).toMatchObject({ branch: 'main', unborn: true });
    expect(parseStatusPorcelainV2(rec(['#', 'branch.head', '(detached)'])).branch).toBe(
      '(detached)',
    );
  });

  it('collects unmerged entries separately', () => {
    const fixture = rec([
      'u',
      'UU',
      'N...',
      '100644',
      '100644',
      '100644',
      '100644',
      H,
      H,
      H,
      'c.txt',
    ]);
    expect(parseStatusPorcelainV2(fixture).conflicted).toEqual(['c.txt']);
  });
});

describe('formatGitStatus', () => {
  it('prints the branch and each group with its count', () => {
    expect(formatGitStatus(parseStatusPorcelainV2(FIXTURE))).toBe(
      [
        'On branch main',
        'staged (4): a.txt, new.txt (from old.txt), quo"te.txt, 한글 파일.txt',
        'unstaged (2): a.txt, sp ace.txt',
        'untracked (1): untracked.txt',
      ].join('\n'),
    );
  });
});

describe('executeGitStatus', () => {
  it('runs exactly one porcelain-v2 call and reports the summary', async () => {
    const port = fakeGitPort({ 'status --porcelain=v2 -z --branch': exited(FIXTURE) });
    const result = await executeGitStatus(port, '/repo');
    expect(port.calls).toEqual([['status', '--porcelain=v2', '-z', '--branch']]);
    expect(result.success).toBe(true);
    expect(result.message).toContain('On branch main');
    expect(result.data).toMatchObject({ git: 'status', untracked: ['untracked.txt'] });
  });

  it('reports git’s own reason on exit 128 and makes no second call', async () => {
    const port = fakeGitPort({
      'status --porcelain=v2 -z --branch': exited(
        '',
        128,
        'fatal: not a git repository (or any of the parent directories): .git\n',
      ),
    });
    const result = await executeGitStatus(port, '/not-a-repo');
    expect(result.success).toBe(false);
    expect(result.message).toContain('fatal: not a git repository');
    expect(port.calls).toHaveLength(1);
  });

  it('reports a spawn failure by its reason', async () => {
    const port = fakeGitPort({
      'status --porcelain=v2 -z --branch': {
        kind: 'failed',
        reason: 'not-found',
        detail: 'git could not be run (ENOENT)',
      },
    });
    const result = await executeGitStatus(port, '/repo');
    expect(result.success).toBe(false);
    expect(result.message).toContain('ENOENT');
  });
});
