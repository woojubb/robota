/**
 * SEC-007 — the pagination floor, proven against the ACTUAL query that produced the false all-clear.
 *
 * The first suite reconstructs SEC-006's measurement on a scripted `gh`: 98 `note` alerts filed most
 * recently, so they fill page one, and the 40 `high` alerts sit on page two. It asserts the failure
 * is real (the single-page read says `0 high` — which is exactly what a clean repository says) and
 * that the paginating reader recovers all 171.
 *
 * The second suite is the scan's own red/green: it must FLAG the reconstructed single-page query and
 * PASS the paginated one.
 */

import { describe, expect, it } from 'vitest';

import { assertComplete, fetchAllPages, mergePages } from '../github-api.mjs';
import { findUnpaginatedQueries } from '../scan-api-pagination.mjs';

const PER_PAGE = 100;

/**
 * SEC-006's measured corpus, in the API's `created`-DESCENDING order.
 *
 * Page one is the 98 freshly-filed `js/unused-local-variable` notes plus 2 warnings — exactly 100
 * records, not one of them security-severity. Every `high` sits on page two. The totals are the ones
 * recorded on 2026-07-26: 1 error, 40 high, 15 medium, 98 note, 17 warning = 171.
 */
function alertCorpus() {
  const make = (n, id, severity, security, from) =>
    Array.from({ length: n }, (_, i) => ({
      number: from + i,
      rule: { id, severity, security_severity_level: security },
    }));
  return [
    ...make(98, 'js/unused-local-variable', 'note', null, 1000),
    ...make(2, 'js/unreachable-statement', 'warning', null, 900),
    ...make(1, 'js/useless-assignment', 'error', null, 800),
    ...make(40, 'js/path-injection', 'error', 'high', 100),
    ...make(15, 'js/shell-command-injection', 'warning', 'medium', 200),
    ...make(15, 'js/unreachable-statement', 'warning', null, 300),
  ];
}

function countHigh(records) {
  return records.filter((r) => r.rule.security_severity_level === 'high').length;
}

/** A scripted `gh` that pages the corpus, honouring (or ignoring) `--paginate` exactly as gh does. */
function scriptedGh(corpus, { perPage = PER_PAGE } = {}) {
  return (args) => {
    const paginate = args.includes('--paginate');
    const pages = [];
    for (let offset = 0; offset < Math.max(corpus.length, 1); offset += perPage) {
      pages.push(corpus.slice(offset, offset + perPage));
      if (!paginate) break;
    }
    return { status: 0, stdout: JSON.stringify(pages), stderr: '' };
  };
}

describe('the pagination trap, reconstructed (SEC-006 → SEC-007)', () => {
  it('a SINGLE-PAGE read reports 0 high — indistinguishable from a clean repository', () => {
    const corpus = alertCorpus();
    const singlePage = JSON.parse(scriptedGh(corpus)(['api']).stdout).flat();

    expect(singlePage.length).toBe(100);
    // The whole defect in one assertion: 40 high alerts are open and the query says none are.
    expect(countHigh(singlePage)).toBe(0);
    expect(countHigh(corpus)).toBe(40);
  });

  it('the paginating reader returns every record, and finds the 40 high alerts', () => {
    const corpus = alertCorpus();
    const { records } = fetchAllPages('repos/o/r/code-scanning/alerts?state=open', {
      runner: scriptedGh(corpus),
    });

    expect(records.length).toBe(171);
    expect(countHigh(records)).toBe(40);
  });

  it('THROWS rather than returning a truncated list when the walk stops on a full page', () => {
    // A bare-array endpoint reports no total, so completeness is proven by the last page being
    // short. A runner that stops after one full page is exactly the trap, and must not be silent.
    const truncating = () => ({ status: 0, stdout: JSON.stringify([alertCorpus().slice(0, 100)]) });

    expect(() =>
      fetchAllPages('repos/o/r/code-scanning/alerts', { runner: truncating }),
    ).toThrowError(/the end of the collection was never observed/);
  });

  it('THROWS when an envelope endpoint reports more records than were read', () => {
    // The strong form: `/check-runs` reports `total_count`, so a short read is provable outright.
    const shortRead = () => ({
      status: 0,
      stdout: JSON.stringify([{ total_count: 21, check_runs: [{ name: 'build' }] }]),
    });

    expect(() =>
      fetchAllPages('repos/o/r/commits/abc/check-runs', { runner: shortRead }),
    ).toThrowError(/read 1 records but the API reports total_count=21/);
  });

  it('accepts an envelope read whose record count matches the reported total', () => {
    const complete = () => ({
      status: 0,
      stdout: JSON.stringify([
        { total_count: 3, check_runs: [{ name: 'a' }, { name: 'b' }] },
        { total_count: 3, check_runs: [{ name: 'c' }] },
      ]),
    });

    const { records, total, pages } = fetchAllPages('repos/o/r/commits/abc/check-runs', {
      runner: complete,
    });
    expect(records.map((r) => r.name)).toEqual(['a', 'b', 'c']);
    expect(total).toBe(3);
    expect(pages).toBe(2);
  });

  it('reports a failed gh invocation as itself, not as an empty result', () => {
    const failing = () => ({ status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' });
    expect(() => fetchAllPages('repos/o/r/nope', { runner: failing })).toThrowError(/HTTP 404/);
  });

  it('reports unparseable stdout as itself, not as an empty result', () => {
    const html = () => ({ status: 0, stdout: '<html>proxy interstitial</html>', stderr: '' });
    expect(() => fetchAllPages('repos/o/r/anything', { runner: html })).toThrowError(
      /unparseable output/,
    );
  });
});

describe('mergePages / assertComplete', () => {
  it('merges bare-array pages and reports no total', () => {
    const merged = mergePages([[1, 2], [3]]);
    expect(merged.records).toEqual([1, 2, 3]);
    expect(merged.total).toBeUndefined();
    expect(merged.pageSizes).toEqual([2, 1]);
  });

  it('finds the items key on an envelope without an endpoint allowlist', () => {
    const merged = mergePages([{ total_count: 2, workflow_runs: [{ id: 1 }, { id: 2 }] }]);
    expect(merged.itemsKey).toBe('workflow_runs');
    expect(merged.records).toHaveLength(2);
  });

  it('treats an empty result as complete', () => {
    expect(() =>
      assertComplete({ records: [], total: undefined, pageSizes: [], perPage: PER_PAGE }),
    ).not.toThrow();
  });

  it('accepts a short final page as proof the collection ended', () => {
    expect(() =>
      assertComplete({ records: new Array(150), pageSizes: [100, 50], perPage: PER_PAGE }),
    ).not.toThrow();
  });
});

describe('scan-api-pagination — red against the query that caused the false all-clear', () => {
  const SEC006_QUERY =
    'gh api "repos/${GITHUB_REPOSITORY}/code-scanning/alerts?state=open&ref=refs/heads/develop&per_page=100" --jq \'.[] | .rule.security_severity_level\'';

  it('FLAGS the reconstructed single-page code-scanning query', () => {
    const findings = findUnpaginatedQueries(SEC006_QUERY, 'reconstructed.sh');
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('per-page-without-paginate');
  });

  it('PASSES the same query once it paginates', () => {
    expect(
      findUnpaginatedQueries(SEC006_QUERY.replace('gh api', 'gh api --paginate'), 'fixed.sh'),
    ).toEqual([]);
  });

  it('FLAGS a collection read with no per_page at all — the API default of 30 is worse', () => {
    const findings = findUnpaginatedQueries(
      'runs="$(gh api "repos/o/r/commits/${SHA}/check-runs" --jq .check_runs)"',
      'workflow.yml',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('unpaginated-collection');
  });

  it('FLAGS the argv form a Node harness script uses', () => {
    const findings = findUnpaginatedQueries(
      "const r = spawnSync('gh', ['api', `repos/${'${slug}'}/rules/branches/main`], { encoding: 'utf8' });",
      'scan-thing.mjs',
    );
    expect(findings).toHaveLength(1);
  });

  it('does NOT flag prose in a Node script that merely quotes the command', () => {
    expect(
      findUnpaginatedQueries(
        'detail: `\\`gh api repos/${slug}/rules/branches/main\\` failed: ${stderr}`,',
        'scan-thing.mjs',
      ),
    ).toEqual([]);
  });

  it('does NOT flag a non-collection endpoint', () => {
    expect(findUnpaginatedQueries('gh api "repos/o/r"', 'workflow.yml')).toEqual([]);
  });

  it('honours an existence-probe annotation carrying a reason', () => {
    const source = [
      '# allow-unpaginated: existence probe only — nothing reads the count',
      'gh api "repos/o/r/code-scanning/analyses?ref=x&per_page=1" --jq length',
    ].join('\n');
    expect(findUnpaginatedQueries(source, 'workflow.yml')).toEqual([]);
  });

  it('accepts the annotation from anywhere in the contiguous comment block above', () => {
    const source = [
      '# allow-unpaginated: existence probe only',
      '# — the response is asked `length != 0` and nothing else.',
      'gh api "repos/o/r/issues/1/labels"',
    ].join('\n');
    expect(findUnpaginatedQueries(source, 'workflow.yml')).toEqual([]);
  });

  it('REJECTS a reason-less annotation, so the hatch cannot decay into a token', () => {
    const source = ['# allow-unpaginated', 'gh api "repos/o/r/issues/1/labels"'].join('\n');
    const kinds = findUnpaginatedQueries(source, 'workflow.yml').map((f) => f.kind);
    expect(kinds).toContain('reasonless-annotation');
    expect(kinds).toContain('unpaginated-collection');
  });

  it('does not report `--paginate` on a continuation line as missing', () => {
    const source = [
      'gh api --paginate \\',
      '  "repos/o/r/code-scanning/alerts?per_page=100" \\',
      '  > out.json',
    ].join('\n');
    expect(findUnpaginatedQueries(source, 'workflow.yml')).toEqual([]);
  });
});
