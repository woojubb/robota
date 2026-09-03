/**
 * Issue #2237 — a superseded check-run reports as concluded, so "all checks concluded" can be true
 * of runs that never ran.
 *
 * The corpus is the one measured on PR #2235 at head `b43e87ae0`: a PR-body edit re-triggered the
 * workflows, the concurrency group cancelled the in-flight wave, and the endpoint then returned the
 * cancelled rows (`completed`/`cancelled`) BESIDE the new wave's `in_progress` rows. A per-row reader
 * says every check concluded; the latest-per-name reader says `quality` is still running.
 */

import { describe, expect, it } from 'vitest';

import { checkRunEvidence, fetchLatestCheckRuns, latestCheckRunsByName } from '../github-api.mjs';

/** The rows PR #2235 returned, in the order the API listed them (newest wave first). */
function superseded() {
  const row = (id, name, status, conclusion, started_at) => ({
    id,
    name,
    status,
    conclusion,
    started_at,
  });
  return [
    row(201, 'quality', 'in_progress', null, '2026-08-23T13:02:00Z'),
    row(202, 'scans', 'queued', null, null),
    row(203, 'review-gate', 'completed', 'success', '2026-08-23T13:02:30Z'),
    row(101, 'quality', 'completed', 'cancelled', '2026-08-23T12:50:00Z'),
    row(102, 'scans', 'completed', 'cancelled', '2026-08-23T12:50:05Z'),
    row(103, 'review-gate', 'completed', 'cancelled', '2026-08-23T12:50:10Z'),
    row(104, 'tui-e2e', 'completed', 'cancelled', '2026-08-23T12:50:15Z'),
  ];
}

describe('latestCheckRunsByName (issue #2237)', () => {
  it('keeps exactly one row per name — the newest — so a superseded cancel cannot speak for a check', () => {
    const latest = latestCheckRunsByName(superseded());
    const byName = Object.fromEntries(latest.map((run) => [run.name, run]));

    expect(Object.keys(byName).sort()).toEqual(['quality', 'review-gate', 'scans', 'tui-e2e']);
    // The per-row reading said every check concluded. The truth: two are still running.
    expect(byName.quality).toMatchObject({ id: 201, status: 'in_progress' });
    expect(byName.scans).toMatchObject({ id: 202, status: 'queued' });
    expect(byName['review-gate']).toMatchObject({ id: 203, conclusion: 'success' });
    // A check whose ONLY row is the cancelled one is still reported — as cancelled, not dropped.
    expect(byName['tui-e2e']).toMatchObject({ id: 104, conclusion: 'cancelled' });
  });

  it('a per-row "all concluded" predicate is true of the old wave and false of the deduped set', () => {
    const concluded = (runs) => runs.every((run) => run.status === 'completed');
    expect(concluded(superseded().filter((run) => run.id < 200))).toBe(true);
    expect(concluded(latestCheckRunsByName(superseded()))).toBe(false);
  });

  it('orders by id first (monotonic, present on a queued run) and by started_at when ids are absent', () => {
    const byStart = latestCheckRunsByName([
      {
        name: 'quality',
        status: 'completed',
        conclusion: 'cancelled',
        started_at: '2026-08-23T12:50:00Z',
      },
      {
        name: 'quality',
        status: 'in_progress',
        conclusion: null,
        started_at: '2026-08-23T13:02:00Z',
      },
    ]);
    expect(byStart).toHaveLength(1);
    expect(byStart[0].status).toBe('in_progress');

    // Input order must not decide: the older row listed last still loses.
    const reversed = latestCheckRunsByName(superseded().reverse());
    expect(reversed.find((run) => run.name === 'quality').id).toBe(201);

    // No id and no start time on one side: the run still waiting to start is the newer one.
    const queued = latestCheckRunsByName([
      {
        name: 'scans',
        status: 'completed',
        conclusion: 'cancelled',
        started_at: '2026-08-23T12:50:05Z',
      },
      { name: 'scans', status: 'queued', conclusion: null, started_at: null },
    ]);
    expect(queued[0].status).toBe('queued');
  });

  it('refuses a record it cannot key rather than dropping it', () => {
    expect(() => latestCheckRunsByName([{ id: 1, status: 'completed' }])).toThrow(/no `name`/);
    expect(() => latestCheckRunsByName({ check_runs: [] })).toThrow(/expected an array/);
  });

  it('checkRunEvidence: cancelled is evidence in NEITHER direction', () => {
    expect(checkRunEvidence({ status: 'completed', conclusion: 'success' })).toBe('success');
    expect(checkRunEvidence({ status: 'completed', conclusion: 'failure' })).toBe('failure');
    expect(checkRunEvidence({ status: 'completed', conclusion: 'timed_out' })).toBe('failure');
    for (const run of [
      { status: 'completed', conclusion: 'cancelled' },
      { status: 'completed', conclusion: 'skipped' },
      { status: 'completed', conclusion: 'neutral' },
      { status: 'in_progress', conclusion: null },
      { status: 'queued', conclusion: null },
      { status: 'completed', conclusion: null },
      null,
    ]) {
      expect(checkRunEvidence(run), JSON.stringify(run)).toBe('none');
    }
  });

  it('fetchLatestCheckRuns reads the paginated envelope and dedupes it', () => {
    const runner = (args) => {
      expect(args).toContain('--paginate');
      expect(args.at(-1)).toBe('repos/woojubb/robota/commits/b43e87ae0/check-runs?per_page=100');
      const rows = superseded();
      return {
        status: 0,
        stdout: JSON.stringify([{ total_count: rows.length, check_runs: rows }]),
        stderr: '',
      };
    };
    const latest = fetchLatestCheckRuns('woojubb/robota', 'b43e87ae0', { runner });
    expect(latest.map((run) => run.name).sort()).toEqual([
      'quality',
      'review-gate',
      'scans',
      'tui-e2e',
    ]);
    expect(latest.find((run) => run.name === 'quality').status).toBe('in_progress');
  });
});
