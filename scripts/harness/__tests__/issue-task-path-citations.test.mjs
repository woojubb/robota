import { describe, expect, it } from 'vitest';

// allow-missing-artifact-file: these fixtures intentionally cite invented Task records to test detection

import {
  auditIssueTaskPaths,
  extractIssueTaskPaths,
  findingSeverity,
  parseAuditArgs,
  readAllIssues,
  runAudit,
  selectActiveIssueScope,
} from '../audit-issue-task-path-citations.mjs';

const issue = (number, body, extra = {}) => ({
  number,
  title: `Issue ${number}`,
  body,
  ...extra,
});

describe('open-issue Task path audit', () => {
  it('checks live prose with line numbers while ignoring fenced examples and pull requests', () => {
    const issues = [
      issue(
        2049,
        [
          'Current: `.agents/tasks/ARCH-060-missing.md`',
          '```text',
          '.agents/tasks/ARCH-061-example.md',
          '```',
          'Completed: `.agents/tasks/BAR-002-done.md`',
          'Archived: `.agents/tasks/ARCH-003-old.md`',
          'Exact: `.agents/tasks/FOO-001-real.md`',
        ].join('\n'),
      ),
      issue(2050, '.agents/tasks/NOPE-001-pr.md', { pull_request: { url: 'fixture' } }),
    ];
    const trackedFiles = [
      '.agents/tasks/FOO-001-real.md',
      '.agents/tasks/completed/BAR-002-done.md',
      '.agents/archive/task-breakdowns/ARCH-003-old.md',
    ];

    const result = auditIssueTaskPaths(issues, trackedFiles);

    expect(result).toMatchObject({ examined: 1, citations: 4 });
    expect(
      result.findings.map(({ issueNumber, line, cited, outcome, actual }) => ({
        issueNumber,
        line,
        cited,
        outcome,
        actual,
      })),
    ).toEqual([
      {
        issueNumber: 2049,
        line: 1,
        cited: '.agents/tasks/ARCH-060-missing.md',
        outcome: 'dangling',
        actual: undefined,
      },
      {
        issueNumber: 2049,
        line: 5,
        cited: '.agents/tasks/BAR-002-done.md',
        outcome: 'moved',
        actual: '.agents/tasks/completed/BAR-002-done.md',
      },
      {
        issueNumber: 2049,
        line: 6,
        cited: '.agents/tasks/ARCH-003-old.md',
        outcome: 'archived',
        actual: '.agents/archive/task-breakdowns/ARCH-003-old.md',
      },
    ]);
  });

  it('preserves a conflict instead of guessing from an ID or slug alone', () => {
    const result = auditIssueTaskPaths(
      [issue(1, '.agents/tasks/ARCH-060-shared-slug.md')],
      ['.agents/tasks/ARCH-060-other.md', '.agents/tasks/ARCH-050-shared-slug.md'],
    );

    expect(result.findings).toMatchObject([{ outcome: 'conflict', issueNumber: 1 }]);
  });

  it('rejects malformed issue data instead of reporting a false clean result', () => {
    expect(() => auditIssueTaskPaths([issue(1, 42)], [])).toThrow(/body/);
    expect(() => auditIssueTaskPaths([issue(0, '')], [])).toThrow(/number/);
  });

  it('reads all issue pages and leaves pull-request filtering to the audit', () => {
    const calls = [];
    const runner = (args) => {
      calls.push(args);
      return {
        status: 0,
        stdout: JSON.stringify([
          [issue(1, ''), issue(2, '', { pull_request: {} })],
          [issue(3, '')],
        ]),
        stderr: '',
      };
    };

    expect(readAllIssues('owner/repo', { runner, perPage: 2 })).toHaveLength(3);
    expect(calls[0]).toContain('repos/owner/repo/issues?state=all&per_page=2');
    expect(() =>
      readAllIssues('owner/repo', {
        runner: () => ({ status: 0, stdout: JSON.stringify([[issue(1, ''), issue(2, '')]]) }),
        perPage: 2,
      }),
    ).toThrow(/end of the collection was never observed/);
  });

  it('requires an explicit repository and reports citation positions deterministically', () => {
    expect(parseAuditArgs(['--repo', 'owner/repo'])).toEqual({ repo: 'owner/repo' });
    expect(() => parseAuditArgs([])).toThrow(/--repo/);
    expect(() => parseAuditArgs(['--repo', '../repo'])).toThrow(/--repo/);
    expect(
      extractIssueTaskPaths(
        'first\n`.agents/tasks/FOO-001-one.md` and `.agents/tasks/BAR-002-two.md`',
      ),
    ).toEqual([
      { line: 2, cited: '.agents/tasks/FOO-001-one.md' },
      { line: 2, cited: '.agents/tasks/BAR-002-two.md' },
    ]);
  });

  it('includes closed source issues directly cited by open issues without recursively sweeping history', () => {
    const issues = [
      issue(1, 'Source #2; PR #4', { state: 'open' }),
      issue(2, 'Prior #3; `.agents/tasks/ARCH-060-missing.md`', { state: 'closed' }),
      issue(3, 'Older `.agents/tasks/ARCH-061-missing.md`', { state: 'closed' }),
      issue(4, 'PR', { state: 'closed', pull_request: {} }),
    ];

    expect(selectActiveIssueScope(issues, 'owner/repo').map(({ number }) => number)).toEqual([
      1, 2,
    ]);
  });

  it('follows same-repository issue URLs but not links to other repositories', () => {
    const issues = [
      issue(
        1,
        'See https://github.com/owner/repo/issues/2 and https://github.com/other/repo/issues/3',
        { state: 'open' },
      ),
      issue(2, '.agents/tasks/ARCH-060-missing.md', { state: 'closed' }),
      issue(3, '.agents/tasks/ARCH-061-missing.md', { state: 'closed' }),
    ];

    expect(selectActiveIssueScope(issues, 'owner/repo').map(({ number }) => number)).toEqual([
      1, 2,
    ]);
  });

  it('audits a referenced closed source issue in the complete fetched collection', () => {
    const records = [
      issue(1, 'Source #2', { state: 'open' }),
      issue(2, '.agents/tasks/ARCH-060-missing.md', { state: 'closed' }),
      issue(3, '.agents/tasks/ARCH-061-missing.md', { state: 'closed' }),
    ];
    const runner = () => ({ status: 0, stdout: JSON.stringify([records]), stderr: '' });

    expect(runAudit({ repo: 'owner/repo', runner, files: [] })).toMatchObject({
      examined: 2,
      citations: 1,
      findings: [{ issueNumber: 2, outcome: 'dangling' }],
    });
  });

  it('fails on fabricated or conflicting paths but reports moved history as a warning', () => {
    expect(findingSeverity('dangling')).toBe('error');
    expect(findingSeverity('conflict')).toBe('error');
    expect(findingSeverity('moved')).toBe('warning');
    expect(findingSeverity('archived')).toBe('warning');
    expect(findingSeverity('renamed')).toBe('warning');
  });
});
