import { describe, expect, it, vi } from 'vitest';

import { fetchAllPages } from '../github-api.mjs';
import { main, measureThroughput, parseArgs } from '../issue-throughput.mjs';

const START = '2026-09-01T00:00:00.000Z';
const END = '2026-09-02T00:00:00.000Z';

function bufferedIo() {
  const output = { stdout: '', stderr: '' };
  return {
    stdout: {
      write: (text) => {
        output.stdout += text;
      },
    },
    stderr: {
      write: (text) => {
        output.stderr += text;
      },
    },
    get stdoutText() {
      return output.stdout;
    },
    get stderrText() {
      return output.stderr;
    },
  };
}

function issue(number, created_at, closed_at = null, extra = {}) {
  return { number, created_at, closed_at, state: closed_at ? 'closed' : 'open', ...extra };
}

function fixtureReader() {
  const activityPages = [
    [
      issue(1, START, '2026-09-01T00:30:00.000Z'),
      issue(2, '2026-09-01T00:30:00.000Z'),
      issue(3, END),
    ],
    [
      issue(4, '2026-08-31T23:59:00.000Z', START),
      issue(5, '2026-08-31T23:59:00.000Z', END),
      issue(6, '2026-09-01T01:00:00.000Z', '2026-09-01T02:00:00.000Z', {
        pull_request: { url: 'https://api.github.com/repos/woojubb/robota/pulls/6' },
      }),
    ],
  ];
  const openPages = [
    [issue(2, '2026-09-01T00:30:00.000Z'), issue(3, END)],
    [issue(7, '2026-08-01T00:00:00.000Z', null, { pull_request: {} })],
  ];
  const readPages = vi.fn((endpoint) => ({
    records: endpoint.includes('state=open') ? openPages.flat() : activityPages.flat(),
    pages: 2,
  }));
  return { readPages, activityPages, openPages };
}

describe('issue throughput measurement', () => {
  it('normalizes timezone input, applies [start,end), excludes pull requests, and reports all counts', () => {
    const { readPages } = fixtureReader();
    const io = bufferedIo();

    const exitCode = main(
      [
        '--repo',
        'woojubb/robota',
        '--start',
        '2026-09-01T09:00:00+09:00',
        '--end',
        '2026-09-02T09:00:00+09:00',
      ],
      io,
      { readPages },
    );

    expect(exitCode).toBe(0);
    const output = JSON.parse(io.stdoutText);
    expect(output).toMatchObject({
      repository: 'woojubb/robota',
      window: {
        start: START,
        end: END,
        boundary: '[start,end)',
        timezone: 'UTC',
      },
      counts: { open: 2, created: 2, closed: 2, net: 0 },
    });
    expect(output.query).toMatchObject({
      issueQualification: 'issues only; records carrying pull_request are excluded',
      created: 'created_at in [start,end)',
      closed: 'closed_at in [start,end)',
    });
    expect(output.pagination).toMatchObject({
      strategy: 'GitHub REST --paginate --slurp',
      pagesRead: { activity: 2, open: 2 },
    });
    expect(readPages).toHaveBeenCalledTimes(2);
    expect(readPages.mock.calls[0][0]).toContain('since=');
    expect(readPages.mock.calls[1][0]).toContain('state=open');
  });

  it('supports a deterministic rolling window from an explicit end', () => {
    const { readPages } = fixtureReader();
    const result = measureThroughput({
      repo: 'woojubb/robota',
      start: '2026-09-01T00:00:00.000Z',
      end: END,
      readPages,
    });

    expect(result.window).toEqual({
      start: START,
      end: END,
      boundary: '[start,end)',
      timezone: 'UTC',
    });
    expect(result.counts.net).toBe(result.counts.created - result.counts.closed);
  });

  it('uses the checked paginated GitHub reader for both collections', () => {
    const { activityPages, openPages } = fixtureReader();
    const calls = [];
    const runner = (args) => {
      expect(args).toContain('--paginate');
      expect(args).toContain('--slurp');
      const endpoint = args.at(-1);
      calls.push(endpoint);
      const pages = endpoint.includes('state=open') ? openPages : activityPages;
      return { status: 0, stdout: JSON.stringify(pages), stderr: '' };
    };

    const result = measureThroughput({
      repo: 'woojubb/robota',
      start: START,
      end: END,
      readPages: (endpoint) => fetchAllPages(endpoint, { runner }),
    });

    expect(result.pagination).toMatchObject({
      strategy: 'GitHub REST --paginate --slurp',
      pagesRead: { activity: 2, open: 2 },
      complete: true,
    });
    expect(calls).toHaveLength(2);
  });

  it('accepts --window with an explicit end and rejects mixed boundary forms', () => {
    expect(parseArgs(['--repo', 'woojubb/robota', '--window', '24h', '--end', END])).toMatchObject({
      repo: 'woojubb/robota',
      windowHours: 24,
      end: END,
    });
    expect(() =>
      parseArgs(['--repo', 'woojubb/robota', '--window', '24h', '--start', START, '--end', END]),
    ).toThrow(/use either --window or --start/);
  });

  it('returns a visible non-zero result when the GitHub read fails', () => {
    const io = bufferedIo();
    const exitCode = main(['--repo', 'woojubb/robota', '--start', START, '--end', END], io, {
      readPages: () => {
        throw new Error('GitHub query failed: permission denied');
      },
    });

    expect(exitCode).toBe(1);
    expect(io.stdoutText).toBe('');
    expect(io.stderrText).toMatch(/::error::GitHub query failed: permission denied/);
  });
});
