/** BEHAVIOR-2437 TC-02 — `/git diff`: the closed grammar and the exact argv sequence per branch. */
import { describe, expect, it } from 'vitest';

import { executeGitDiff, gitDiffArgv, parseGitDiffArgs, GIT_DIFF_USAGE } from '../git-diff.js';

import { exited, fakeGitPort } from './fake-git-port.js';

const revParse = (rev: string): string =>
  `rev-parse --verify --quiet --end-of-options ${rev}^{commit}`;

describe('parseGitDiffArgs', () => {
  it('accepts the four forms and the path list', () => {
    expect(parseGitDiffArgs([])).toEqual({
      ok: true,
      args: { target: { kind: 'worktree' }, paths: [] },
    });
    expect(parseGitDiffArgs(['--staged'])).toMatchObject({
      ok: true,
      args: { target: { kind: 'staged' } },
    });
    expect(parseGitDiffArgs(['HEAD~1'])).toMatchObject({
      ok: true,
      args: { target: { kind: 'revision', revision: 'HEAD~1' } },
    });
    expect(parseGitDiffArgs(['main..feature', '--', 'p', 'q'])).toEqual({
      ok: true,
      args: { target: { kind: 'range', from: 'main', to: 'feature' }, paths: ['p', 'q'] },
    });
  });

  it('refuses every other dash token with the usage line', () => {
    for (const token of ['--output=/tmp/x', '-p', '--cached', '-U3']) {
      const parsed = parseGitDiffArgs([token]);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.message).toContain(token);
        expect(parsed.message).toContain(GIT_DIFF_USAGE);
      }
    }
  });

  it('refuses a malformed range, a bare `--`, and extra positionals', () => {
    expect(parseGitDiffArgs(['a..'])).toMatchObject({ ok: false });
    expect(parseGitDiffArgs(['a...b'])).toMatchObject({ ok: false });
    expect(parseGitDiffArgs(['--'])).toMatchObject({ ok: false });
    expect(parseGitDiffArgs(['a', 'b'])).toMatchObject({ ok: false });
  });
});

describe('gitDiffArgv', () => {
  it('places --end-of-options before revisions and -- before paths', () => {
    expect(gitDiffArgv({ target: { kind: 'worktree' }, paths: [] })).toEqual(['diff']);
    expect(gitDiffArgv({ target: { kind: 'staged' }, paths: [] })).toEqual(['diff', '--staged']);
    expect(gitDiffArgv({ target: { kind: 'revision', revision: '-p' }, paths: ['-p'] })).toEqual([
      'diff',
      '--end-of-options',
      '-p',
      '--',
      '-p',
    ]);
    expect(
      gitDiffArgv({ target: { kind: 'range', from: 'a', to: 'b' }, paths: ['p', 'q'] }),
    ).toEqual(['diff', '--end-of-options', 'a..b', '--', 'p', 'q']);
  });
});

describe('executeGitDiff', () => {
  it('bare and --staged run one diff call each', async () => {
    const port = fakeGitPort({ diff: exited('+x\n'), 'diff --staged': exited('') });
    expect((await executeGitDiff(port, '/r', '')).message).toBe('+x');
    expect((await executeGitDiff(port, '/r', '--staged')).message).toBe('No differences.');
    expect(port.calls).toEqual([['diff'], ['diff', '--staged']]);
  });

  it('verifies one revision, then diffs, with a trailing path list', async () => {
    const port = fakeGitPort({
      [revParse('HEAD~1')]: exited('abc\n'),
      'diff --end-of-options HEAD~1 -- p q': exited('+y\n'),
    });
    const result = await executeGitDiff(port, '/r', 'HEAD~1 -- p q');
    expect(result.success).toBe(true);
    expect(port.calls).toEqual([
      ['rev-parse', '--verify', '--quiet', '--end-of-options', 'HEAD~1^{commit}'],
      ['diff', '--end-of-options', 'HEAD~1', '--', 'p', 'q'],
    ]);
  });

  it('verifies both ends of a range before one diff call', async () => {
    const port = fakeGitPort({
      [revParse('a')]: exited('1\n'),
      [revParse('b')]: exited('2\n'),
      'diff --end-of-options a..b': exited(''),
    });
    await executeGitDiff(port, '/r', 'a..b');
    expect(port.calls.map((c) => c.join(' '))).toEqual([
      revParse('a'),
      revParse('b'),
      'diff --end-of-options a..b',
    ]);
  });

  it('refuses an unknown revision by name with no diff call', async () => {
    const port = fakeGitPort({ [revParse('nosuchrev')]: exited('', 1) });
    const result = await executeGitDiff(port, '/r', 'nosuchrev');
    expect(result.success).toBe(false);
    expect(result.message).toContain('nosuchrev');
    expect(port.calls).toHaveLength(1);
  });

  it('refuses a flag with the usage line and no call at all', async () => {
    const port = fakeGitPort({});
    const result = await executeGitDiff(port, '/r', '--output=/tmp/x');
    expect(result.success).toBe(false);
    expect(result.message).toContain('--output=/tmp/x');
    expect(result.message).toContain('--staged');
    expect(port.calls).toEqual([]);
  });

  it('reports a diff failure with git’s stderr', async () => {
    const port = fakeGitPort({ diff: exited('', 129, 'fatal: bad\n') });
    const result = await executeGitDiff(port, '/r', '');
    expect(result.success).toBe(false);
    expect(result.message).toContain('fatal: bad');
  });
});
