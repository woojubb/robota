import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  datesAfter,
  commitsSince,
  gatherDayData,
  workDaysNeedingReport,
  renderReport,
  lastReportedDate,
  REPORTS_DIR,
} from '../daily-report.mjs';

const SEP = String.fromCharCode(31);

/** Fake git: `log` returns joined commit lines; `diff-tree` returns a per-hash file list. */
function fakeGit({ commits = [], files = {} } = {}) {
  return (args) => {
    if (args[0] === 'log') {
      return commits.map((c) => [c.hash, c.cISO, c.subject, c.author].join(SEP)).join('\n');
    }
    if (args[0] === 'diff-tree') return (files[args[args.length - 1]] ?? []).join('\n');
    return '';
  };
}

describe('OBSERVABILITY-001 daily-report harness', () => {
  it('datesAfter is exclusive-after, inclusive-through; null start yields only the through day', () => {
    expect(datesAfter('2026-07-15', '2026-07-18')).toEqual([
      '2026-07-16',
      '2026-07-17',
      '2026-07-18',
    ]);
    expect(datesAfter(null, '2026-07-18')).toEqual(['2026-07-18']);
  });

  it('commitsSince tags each commit with its true UTC day, even for a non-Z timezone offset', () => {
    const runGit = fakeGit({
      commits: [
        { hash: 'aaaaaaa', cISO: '2026-07-18T23:30:00Z', subject: 'feat: x (#10)', author: 'w' },
        // Committed 02:00 in +09:00 (KST) = 2026-07-17T17:00Z → must tag the UTC day 2026-07-17,
        // NOT the committer-local day 2026-07-18 (the bug a plain `.slice(0,10)` would produce).
        { hash: 'bbbbbbb', cISO: '2026-07-18T02:00:00+09:00', subject: 'fix: y', author: 'w' },
      ],
    });
    const commits = commitsSince(null, runGit);
    expect(commits.map((c) => c.utcDay)).toEqual(['2026-07-18', '2026-07-17']);
    expect(commits[0].subject).toBe('feat: x (#10)');
  });

  it('gatherDayData collects one day’s commits, PR numbers, and specs/tasks touched', () => {
    const commits = [
      { hash: 'aaaaaaa1', utcDay: '2026-07-18', subject: 'feat: a (#42)', author: 'w' },
      { hash: 'bbbbbbb2', utcDay: '2026-07-18', subject: 'chore: b', author: 'w' },
      { hash: 'ccccccc3', utcDay: '2026-07-17', subject: 'old (#1)', author: 'w' },
    ];
    const runGit = fakeGit({
      files: {
        aaaaaaa1: ['packages/x/src/a.ts', '.agents/spec-docs/active/FOO.md'],
        bbbbbbb2: ['.agents/tasks/FOO.md'],
      },
    });
    const data = gatherDayData('2026-07-18', commits, runGit);
    expect(data.commits.map((c) => c.hash)).toEqual(['aaaaaaa', 'bbbbbbb']); // 7-char, only the day
    expect(data.mergedPrs).toEqual([{ number: '42', subject: 'feat: a (#42)' }]);
    expect(data.specs).toEqual(['.agents/spec-docs/active/FOO.md']);
    expect(data.tasks).toEqual(['.agents/tasks/FOO.md']);
  });

  it('workDaysNeedingReport catches up after the last report and skips no-work days', () => {
    const root = mkdtempSync(join(tmpdir(), 'daily-report-'));
    mkdirSync(join(root, REPORTS_DIR), { recursive: true });
    writeFileSync(join(root, REPORTS_DIR, '2026-07-15.md'), '# report', 'utf8');

    const runGit = fakeGit({
      commits: [
        // Committer-local day 2026-07-17 (+09:00) but UTC day 2026-07-16 → must count for 16, not 17.
        { hash: 'a', cISO: '2026-07-17T02:00:00+09:00', subject: 'work 16', author: 'w' },
        { hash: 'b', cISO: '2026-07-18T10:00:00Z', subject: 'work 18', author: 'w' },
        // 2026-07-17 has NO (UTC) commit → skipped; 2026-07-15 already reported.
      ],
    });
    expect(lastReportedDate(root)).toBe('2026-07-15');
    expect(workDaysNeedingReport('2026-07-18', { root, runGit })).toEqual([
      '2026-07-16',
      '2026-07-18',
    ]);
  });

  it('renderReport fills factual sections + a Summary placeholder; empty sections read _none_', () => {
    const full = renderReport({
      date: '2026-07-18',
      commits: [{ hash: 'abc1234', subject: 'feat: x (#42)', author: 'w' }],
      mergedPrs: [{ number: '42', subject: 'feat: x (#42)' }],
      files: ['a.ts'],
      specs: ['.agents/spec-docs/done/FOO.md'],
      tasks: [],
    });
    expect(full).toContain('# Daily Work Report — 2026-07-18 (UTC)');
    expect(full).toContain('_(pending agent summary)_');
    expect(full).toContain('#42 — feat: x');
    expect(full).toContain('`abc1234`');
    expect(full).toContain('.agents/spec-docs/done/FOO.md');

    const empty = renderReport({
      date: '2026-07-18',
      commits: [],
      mergedPrs: [],
      files: [],
      specs: [],
      tasks: [],
    });
    expect(empty).toContain('_none_');
  });
});
