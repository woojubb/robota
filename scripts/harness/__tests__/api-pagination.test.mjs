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

import {
  assertComplete,
  fetchAllPages,
  isRateLimited,
  mergePages,
  readWithBackoff,
  retryDelaySeconds,
} from '../github-api.mjs';
import { findParallelFanOut } from '../scan-api-pagination.mjs';
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

/**
 * A rate limit is a budget to wait out, not a defect to work around.
 *
 * A burst of a few thousand requests trips the API's secondary limit, and it answers with 403 — the
 * same status as a permission error — carrying a rate-limit signature in the message. Two wrong
 * responses follow from reading that as an ordinary failure: aborting a read that would have
 * succeeded shortly, or retrying immediately, which keeps a secondary limit alive.
 */
describe('a rate-limited read waits and retries (github-api)', () => {
  it('recognises the limit signature and not an ordinary permission error', () => {
    expect(isRateLimited('API rate limit exceeded for user ID 1')).toBe(true);
    expect(isRateLimited('You have exceeded a secondary rate limit')).toBe(true);
    expect(isRateLimited('Resource not accessible by integration')).toBe(false);
    expect(isRateLimited('')).toBe(false);
  });

  it('waits the time the API names, preferring Retry-After over the reset header', () => {
    expect(retryDelaySeconds('retry-after: 42')).toBe(42);
    const now = 1_000_000_000_000;
    expect(retryDelaySeconds('x-ratelimit-reset: 1000000090', { now })).toBe(90);
    // No header at all: a documented floor, because guessing shorter is how a retry loop becomes
    // the thing keeping the limit alive.
    expect(retryDelaySeconds('API rate limit exceeded')).toBe(60);
  });

  it('(RED) retries after the wait instead of failing the read', () => {
    const slept = [];
    let call = 0;
    const runner = () => {
      call += 1;
      return call === 1
        ? { status: 1, stdout: '', stderr: 'API rate limit exceeded\nretry-after: 3' }
        : { status: 0, stdout: '[]', stderr: '' };
    };
    const response = readWithBackoff(runner, ['api', 'x'], 'x', { sleep: (s) => slept.push(s) });
    expect(response.status).toBe(0);
    expect(slept).toEqual([3]);
  });

  it('gives up with the budget named, rather than looping forever', () => {
    const runner = () => ({ status: 1, stdout: '', stderr: 'API rate limit exceeded' });
    expect(() =>
      readWithBackoff(runner, ['api', 'x'], 'x', { attempts: 2, sleep: () => {} }),
    ).toThrow(/still limited after 2 attempts/);
  });

  it('rejects a non-positive attempt count instead of reporting a TypeError', () => {
    // A loop that never runs falls through to the trailing throw and dereferences an undefined
    // response — an error about the error.
    expect(() =>
      readWithBackoff(() => ({ status: 0 }), ['api', 'x'], 'x', { attempts: 0 }),
    ).toThrow(/attempts must be a positive integer/);
  });

  it('INFRA-103: a failure reports WHAT IT ASKED, not only which endpoint', () => {
    // The message that cost an afternoon said the endpoint and the status and nothing about the
    // request. Two steps of one CI job read the SAME endpoint seconds apart — one with these flags
    // and one without — and only one failed. The flags were the only difference, and they were the
    // one thing the error did not carry.
    expect(() =>
      readWithBackoff(
        () => ({ status: 1, stderr: 'gh: Validation Failed (HTTP 422)' }),
        ['api', '--paginate', '--slurp', 'repos/o/r/issues/1/labels?per_page=100'],
        'repos/o/r/issues/1/labels',
      ),
    ).toThrow(/requested: gh api --paginate --slurp repos\/o\/r\/issues\/1\/labels\?per_page=100/);
  });

  it('INFRA-103: and which gh produced it, since the same read succeeds elsewhere', () => {
    let threw;
    try {
      readWithBackoff(() => ({ status: 1, stderr: 'boom' }), ['api', 'x'], 'x');
    } catch (error) {
      threw = error;
    }

    // Not asserting a version string — the point is that the line is present and answered, so
    // "which gh was this" stops being a question somebody has to ask by hand.
    expect(threw?.message).toMatch(/\n {2}gh: .+/);
  });

  it('does NOT retry an ordinary failure — that would hide a real error behind a wait', () => {
    let calls = 0;
    const runner = () => {
      calls += 1;
      return { status: 1, stdout: '', stderr: 'Not Found' };
    };
    expect(() => readWithBackoff(runner, ['api', 'x'], 'x', { sleep: () => {} })).toThrow(
      /Not Found/,
    );
    expect(calls).toBe(1);
  });
});

/**
 * The burst, not the page walk.
 *
 * A read that walks pages one at a time is the correct shape and must not be flagged. What earns a
 * finding is many independent calls dispatched at once, because the API answers a burst with a
 * SECONDARY limit — a 403 carrying a rate-limit message, which the rate-limit endpoint does not
 * report, so the budget looks healthy while every call is refused.
 */
describe('a parallel fan-out of API calls is flagged (api-pagination)', () => {
  it('(RED) flags an xargs -P fan-out of gh api calls', () => {
    const script = [
      '#!/usr/bin/env bash',
      'fetch_one() { gh api "repos/o/r/actions/runs/$1/jobs?per_page=100" --paginate; }',
      "cat run_ids.txt | xargs -P 12 -I{} bash -c 'fetch_one {}'",
    ].join('\n');
    const found = findParallelFanOut(script, 'burst.sh');
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('parallel-api-fan-out');
  });

  it('does NOT flag a serial page walk — that is the correct shape', () => {
    const script = ['gh api "repos/o/r/actions/runs?per_page=100" --paginate --slurp'].join('\n');
    expect(findParallelFanOut(script, 'ok.sh')).toEqual([]);
  });

  it('(RED) flags a two-digit `parallel -j` and an UNBOUNDED `-P0`', () => {
    // The first version alternated digit patterns asymmetrically: `xargs -P` matched two digits and
    // `parallel -j` did not, so the bigger the fan-out the likelier it passed. And `-P0` — "as many
    // as possible" — matched nothing at all, so the most aggressive case was the one that slipped.
    const twoDigit = 'cat ids | parallel -j 16 gh api repos/o/r/x/{}';
    const unbounded = 'cat ids | xargs -P0 -I{} gh api repos/o/r/x/{}';
    expect(findParallelFanOut(twoDigit, 'a.sh')).toHaveLength(1);
    expect(findParallelFanOut(unbounded, 'b.sh')).toHaveLength(1);
  });

  it('does NOT flag `-P1`, which is serial', () => {
    expect(findParallelFanOut('cat ids | xargs -P1 -I{} gh api repos/o/r/x/{}', 'c.sh')).toEqual(
      [],
    );
  });

  it('(RED) does NOT flag an unrelated parallel loop merely because the FILE calls an API', () => {
    // The check tested the whole file, so any script containing one API call anywhere turned every
    // parallel loop in it into a finding — the false positive that gets a check suppressed rather
    // than obeyed.
    const mixed = [
      '#!/usr/bin/env bash',
      'gh api repos/o/r/actions/runs --paginate --slurp > runs.json',
      'ls src | xargs -P 8 -I{} node build.mjs {}',
    ].join('\n');
    expect(findParallelFanOut(mixed, 'mixed.sh')).toEqual([]);
  });

  it('DOES flag the call one indirection away, which is the shape that caused this', () => {
    const indirect = [
      'fetch_one() { gh api "repos/o/r/actions/runs/$1/jobs" --paginate; }',
      "cat ids | xargs -P 12 -I{} bash -c 'fetch_one {}'",
    ].join('\n');
    expect(findParallelFanOut(indirect, 'burst.sh')).toHaveLength(1);
  });

  it('does NOT treat a single backgrounded command as a fan-out', () => {
    // It has no degree, and a check that cannot say how parallel something is cannot say it is too
    // parallel. The first version returned NaN here, which passed a `!== null` test as "detected".
    const bg = ['gh api repos/o/r/x > out.json &'].join('\n');
    expect(findParallelFanOut(bg, 'bg.sh')).toEqual([]);
  });

  it('does NOT flag a parallel job that touches no API', () => {
    const script = ['ls src | xargs -P 8 -I{} node build.mjs {}'].join('\n');
    expect(findParallelFanOut(script, 'build.sh')).toEqual([]);
  });

  it('honours its OWN reasoned suppression', () => {
    const withReason = [
      '# allow-parallel-fan-out: one call per id, bounded to 3 ids by the caller',
      'cat ids | xargs -P 4 -I{} gh api repos/o/r/x/{}',
    ].join('\n');
    expect(findParallelFanOut(withReason, 'ok.sh')).toEqual([]);
  });

  it("does NOT accept the PAGINATION rule's token — a hatch must name the rule it waives", () => {
    // Two rules, two reasons: `allow-unpaginated:` says "this read need not paginate", which says
    // nothing about whether a burst of calls is safe. A hatch that names a different rule leaves the
    // next reader unable to tell which one was waived.
    const wrongToken = [
      '# allow-unpaginated: this read is a single record',
      'cat ids | xargs -P 4 -I{} gh api repos/o/r/x/{}',
    ].join('\n');
    expect(findParallelFanOut(wrongToken, 'x.sh')).toHaveLength(1);
  });
});
