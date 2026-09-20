/** BEHAVIOR-2437 TC-03 — `/git commit`: every branch of the staged-check → subject → confirm flow. */
import { describe, expect, it } from 'vitest';

import {
  executeGitCommit,
  normalizeCommitSubject,
  validateConventionalSubject,
} from '../git-commit.js';

import { exited, fakeGitPort } from './fake-git-port.js';

import type { IActionRequest, IUserInteraction, TActionResponse } from '@robota-sdk/agent-core';

const STAGED = 'diff --cached --quiet';
const LISTING = 'diff --cached --name-status';
const STATUS = 'status --porcelain=v2 -z --branch';
const H = '0000000000000000000000000000000000000000';
const NOTHING_STAGED_STATUS =
  `# branch.head main\0` +
  `1 .M N... 100644 100644 100644 ${H} ${H} notes.txt\0` +
  `? scratch.log\0`;

function scriptedUi(
  answer: (request: IActionRequest) => TActionResponse,
): IUserInteraction & { readonly asked: IActionRequest[] } {
  const asked: IActionRequest[] = [];
  return {
    asked,
    async ask(request) {
      asked.push(request);
      return answer(request);
    },
  };
}
const yes = (): TActionResponse => ({ type: 'answer', values: ['yes'] });
const no = (): TActionResponse => ({ type: 'answer', values: ['no'] });

describe('validateConventionalSubject', () => {
  it('accepts the MUST forms and only warns on the conventions', () => {
    expect(validateConventionalSubject('feat!: x')).toEqual({ ok: true, warnings: [] });
    expect(validateConventionalSubject('fix(scope): y')).toEqual({ ok: true, warnings: [] });
    expect(validateConventionalSubject('feat(a-b)!: z')).toEqual({ ok: true, warnings: [] });
    const long = validateConventionalSubject(`feat: ${'x'.repeat(80)}`);
    expect(long.ok).toBe(true);
    if (long.ok) expect(long.warnings[0]).toContain('72');
    const odd = validateConventionalSubject('wip: thing.');
    expect(odd.ok).toBe(true);
    if (odd.ok) {
      expect(odd.warnings.some((w) => w.includes('"wip"'))).toBe(true);
      expect(odd.warnings.some((w) => w.includes('period'))).toBe(true);
    }
  });

  it('refuses a MUST-rule violation naming the rule', () => {
    const noSeparator = validateConventionalSubject('add greeting');
    expect(noSeparator).toMatchObject({ ok: false });
    if (!noSeparator.ok) expect(noSeparator.reason).toContain('`: `');
    expect(validateConventionalSubject('feat: ')).toMatchObject({ ok: false });
    expect(validateConventionalSubject('feat:')).toMatchObject({ ok: false });
    expect(validateConventionalSubject('feat scope: x')).toMatchObject({ ok: false });
    expect(validateConventionalSubject('(scope): x')).toMatchObject({ ok: false });
    expect(validateConventionalSubject('')).toMatchObject({ ok: false });
  });
});

describe('normalizeCommitSubject', () => {
  it('strips a leading -m and ONE matching pair of outer quotes', () => {
    expect(normalizeCommitSubject('feat: x')).toBe('feat: x');
    expect(normalizeCommitSubject('-m feat: x')).toBe('feat: x');
    expect(normalizeCommitSubject('"feat: x"')).toBe('feat: x');
    expect(normalizeCommitSubject("'feat: x'")).toBe('feat: x');
    expect(normalizeCommitSubject('""feat: x""')).toBe('"feat: x"');
    expect(normalizeCommitSubject('"feat: x')).toBe('"feat: x');
    expect(normalizeCommitSubject('-m')).toBe('');
  });
});

describe('executeGitCommit', () => {
  it('nothing staged → guidance with the counts, no commit call, no dialog', async () => {
    const port = fakeGitPort({ [STAGED]: exited('', 0), [STATUS]: exited(NOTHING_STAGED_STATUS) });
    const ui = scriptedUi(yes);
    const result = await executeGitCommit(port, '/r', 'feat: nothing to commit', ui);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Nothing is staged (1 unstaged, 1 untracked)');
    expect(result.message).toContain('git add');
    expect(result.message).toContain('/shell git add');
    expect(ui.asked).toEqual([]);
    expect(port.calls.map((c) => c[0])).not.toContain('commit');
  });

  it('a MUST-rule violation is refused before any listing or dialog', async () => {
    const port = fakeGitPort({ [STAGED]: exited('', 1) });
    const ui = scriptedUi(yes);
    const result = await executeGitCommit(port, '/r', 'add greeting', ui);
    expect(result.success).toBe(false);
    expect(result.message).toContain('`: `');
    expect(ui.asked).toEqual([]);
    expect(port.calls).toEqual([['diff', '--cached', '--quiet']]);
  });

  it('a refused confirmation → "Commit cancelled." and no commit call', async () => {
    const port = fakeGitPort({ [STAGED]: exited('', 1), [LISTING]: exited('M\tgreeting.txt\n') });
    const ui = scriptedUi(no);
    const result = await executeGitCommit(port, '/r', 'feat: add greeting', ui);
    expect(result.success).toBe(false);
    expect(result.message).toBe('Commit cancelled.');
    expect(ui.asked).toHaveLength(1);
    expect(ui.asked[0]?.description).toContain('feat: add greeting');
    expect(ui.asked[0]?.description).toContain('M greeting.txt');
    expect(port.calls.map((c) => c[0])).not.toContain('commit');
  });

  it('an absent IUserInteraction is a cancellation, never a commit', async () => {
    const port = fakeGitPort({ [STAGED]: exited('', 1), [LISTING]: exited('M\tgreeting.txt\n') });
    const result = await executeGitCommit(port, '/r', 'feat: add greeting', undefined);
    expect(result.success).toBe(false);
    expect(result.message).toContain('cancelled');
    expect(result.message).toContain('confirmation');
    // Nothing beyond the staged check runs: no listing, no commit.
    expect(port.calls).toEqual([['diff', '--cached', '--quiet']]);
  });

  it('a confirmed commit runs exactly commit -m <subject> after the listing, quotes stripped', async () => {
    const port = fakeGitPort({
      [STAGED]: exited('', 1),
      [LISTING]: exited('M\tgreeting.txt\n'),
      'commit -m feat: add greeting': exited(
        '[main abc1234] feat: add greeting\n 1 file changed\n',
      ),
    });
    const ui = scriptedUi(yes);
    const result = await executeGitCommit(port, '/r', '"feat: add greeting"', ui);
    expect(result.success).toBe(true);
    expect(result.message).toContain('abc1234');
    expect(result.message).toContain('feat: add greeting');
    expect(port.calls).toEqual([
      ['diff', '--cached', '--quiet'],
      ['diff', '--cached', '--name-status'],
      ['commit', '-m', 'feat: add greeting'],
    ]);
    expect(port.calls.flat()).not.toContain('-a');
    expect(port.calls.map((c) => c[0])).not.toContain('add');
  });

  it('a long subject only warns in the confirmation and still commits', async () => {
    const subject = `feat: ${'x'.repeat(80)}`;
    const port = fakeGitPort({
      [STAGED]: exited('', 1),
      [LISTING]: exited('A\tnew.txt\n'),
      [`commit -m ${subject}`]: exited(`[main 1234567] ${subject}\n`),
    });
    const ui = scriptedUi(yes);
    const result = await executeGitCommit(port, '/r', subject, ui);
    expect(result.success).toBe(true);
    expect(ui.asked[0]?.description).toContain('Warning:');
    expect(ui.asked[0]?.description).toContain('72');
  });

  it('with no inline subject, asks for one as free text and validates the answer', async () => {
    const port = fakeGitPort({
      [STAGED]: exited('', 1),
      [LISTING]: exited('A\tnew.txt\n'),
      'commit -m fix: typo': exited('[main 1234567] fix: typo\n'),
    });
    const ui = scriptedUi((request) =>
      request.id === 'git-commit-subject'
        ? { type: 'answer', values: [], text: 'fix: typo' }
        : yes(),
    );
    const result = await executeGitCommit(port, '/r', '', ui);
    expect(result.success).toBe(true);
    expect(ui.asked.map((r) => r.id)).toEqual(['git-commit-subject', 'git-commit']);
  });

  it('a failing commit (hook) reports git’s stderr', async () => {
    const port = fakeGitPort({
      [STAGED]: exited('', 1),
      [LISTING]: exited('A\tnew.txt\n'),
      'commit -m feat: x': exited('', 1, 'pre-commit hook refused\n'),
    });
    const result = await executeGitCommit(port, '/r', 'feat: x', scriptedUi(yes));
    expect(result.success).toBe(false);
    expect(result.message).toContain('pre-commit hook refused');
  });
});
