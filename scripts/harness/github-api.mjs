#!/usr/bin/env node

/**
 * SEC-007 — the ONE way harness code reads a paginated GitHub API, and the count assertion that
 * makes a truncated read impossible to mistake for a clean result.
 *
 * ## The trap this exists to close
 *
 * The code-scanning alerts endpoint returns records sorted by `created` DESCENDING and pages at 100.
 * SEC-005 had just filed 98 `js/unused-local-variable` notes — the newest alerts in the repo — so
 * they filled the entire first page and every security-severity alert sat on page 2. A single-page
 * query therefore reported `0 high` on ANY ref, which is byte-for-byte what a genuinely clean
 * repository looks like. That produced a reported all-clear while 40 high-severity alerts were open,
 * and it was the SECOND time an unpaginated `gh api` produced a false all-clear in this repo
 * (SEC-003 measured ~170 alerts only because it happened to paginate).
 *
 * The failure mode is what makes it dangerous: truncation is SILENT and its output is
 * indistinguishable from success. Nothing goes red, nothing is missing, the number is just wrong.
 *
 * ## What "must paginate" is not enough on its own
 *
 * `--paginate` follows `Link: rel="next"` to exhaustion, so it is the fix — but a caller cannot tell
 * from the output whether it worked. So every read here is CHECKED, by whichever of two invariants
 * the endpoint supports:
 *
 *  - **Envelope endpoints** (`{ total_count, <items>: [...] }` — check-runs, workflow runs, search)
 *    report the true total. The record count MUST equal it. This is the strongest form, and it also
 *    catches a page that failed mid-walk.
 *  - **Bare-array endpoints** (code-scanning alerts, labels, branch rules) report no total, so the
 *    end of the walk is proven instead: the LAST page must be SHORT (fewer than `per_page` records).
 *    A last page that is exactly full means either the walk stopped early or the collection ends on
 *    an exact multiple — indistinguishable from the outside, and therefore not something to pass.
 *
 * Both are assertions, not warnings: a read that cannot prove it is complete throws rather than
 * returning a number a caller will treat as authoritative.
 *
 * Usable two ways — as a module (`fetchAllPages`) and as a CLI for workflow steps:
 *
 *   node scripts/harness/github-api.mjs <endpoint> [--per-page N] [--jq <expr>]
 *
 * The CLI prints the merged records as JSON (or the `--jq` projection of them) and exits non-zero if
 * the completeness assertion fails.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

/** GitHub's maximum for `per_page` on the endpoints harness code reads. */
export const DEFAULT_PER_PAGE = 100;

/**
 * Merge `gh api --paginate --slurp` output (an array of PAGES) into one record list.
 *
 * Two page shapes exist and they are told apart by structure, not by an endpoint allowlist — an
 * allowlist would silently mis-handle the next endpoint someone reads.
 */
export function mergePages(pages, { endpoint = '(endpoint)' } = {}) {
  if (!Array.isArray(pages)) {
    throw new Error(
      `${endpoint}: expected an array of pages from \`--slurp\`, got ${typeof pages}`,
    );
  }
  if (pages.length === 0) return { records: [], total: undefined, pageSizes: [] };

  // Bare-array pages: `[ [...], [...] ]`
  if (pages.every((page) => Array.isArray(page))) {
    return {
      records: pages.flat(),
      total: undefined,
      pageSizes: pages.map((page) => page.length),
    };
  }

  // Envelope pages: `[ { total_count, <items>: [...] }, ... ]`
  const first = pages[0];
  if (first === null || typeof first !== 'object') {
    throw new Error(
      `${endpoint}: unrecognised page shape (${JSON.stringify(first).slice(0, 120)})`,
    );
  }
  const itemsKey = Object.keys(first).find((key) => Array.isArray(first[key]));
  if (itemsKey === undefined) {
    throw new Error(`${endpoint}: no array property on the response envelope — is it paginated?`);
  }
  const total = typeof first['total_count'] === 'number' ? first['total_count'] : undefined;
  const pageSizes = pages.map((page) =>
    Array.isArray(page?.[itemsKey]) ? page[itemsKey].length : 0,
  );
  return { records: pages.flatMap((page) => page?.[itemsKey] ?? []), total, pageSizes, itemsKey };
}

/**
 * Throw unless the read can PROVE it saw every record. See the header for why each branch is the
 * strongest available check rather than the most convenient one.
 */
export function assertComplete({ records, total, pageSizes, perPage, endpoint = '(endpoint)' }) {
  if (total !== undefined) {
    if (records.length !== total) {
      throw new Error(
        `${endpoint}: read ${records.length} records but the API reports total_count=${total}. ` +
          `The read is INCOMPLETE — a partial count from a paginated endpoint is not a result.`,
      );
    }
    return;
  }
  if (pageSizes.length === 0) return;
  const lastPage = pageSizes[pageSizes.length - 1];
  if (lastPage >= perPage) {
    throw new Error(
      `${endpoint}: the last page returned ${lastPage} records with per_page=${perPage}, so the end ` +
        `of the collection was never observed. This endpoint reports no total_count, so a full final ` +
        `page cannot be distinguished from a walk that stopped early.`,
    );
  }
}

/** Default runner: `gh api --paginate --slurp`. Injected in tests so no network is needed. */
function ghRunner(args) {
  return spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * The `gh` build that produced a failure, for the error message only.
 *
 * Read ONLY on the failure path: a version probe on every successful read would spend a process per
 * call to answer a question nobody asked. It matters when a read fails in CI and succeeds on a
 * developer machine, which is the shape INFRA-103 is stuck on — "which gh" was unanswerable from the
 * log, so it stayed a hypothesis for as long as it took to ask by hand.
 *
 * Its own failure is not an error. This runs while reporting one, and a diagnostic that can throw
 * would replace the real message with its own.
 */
function ghVersion() {
  const probe = spawnSync('gh', ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0) return 'unknown';
  return (probe.stdout ?? '').split('\n')[0]?.trim() || 'unknown';
}

/**
 * A rate-limited response is not a failed read — it is a read that must be repeated later.
 *
 * The API answers an exhausted budget with 403 (not 429) plus a rate-limit signature, and the
 * unhelpful part is what that looks like to a caller: an error mentioning "rate limit" among ordinary
 * permission errors. Treating it as a permanent failure aborts a scan that would have succeeded thirty
 * seconds later; retrying it immediately makes the limit worse and can extend a secondary limit.
 *
 * So: recognise it, wait the time the API itself names, and try again a bounded number of times. When
 * the budget cannot be recovered within the bound, the error says so in those terms rather than as an
 * opaque non-zero exit.
 */
export function isRateLimited(stderr) {
  return /rate limit|secondary rate|abuse detection|too many requests/i.test(stderr ?? '');
}

/** Seconds to wait before retrying, from the API's own headers when it supplies them. */
export function retryDelaySeconds(stderr, { now = Date.now() } = {}) {
  const retryAfter = /retry-after:\s*(\d+)/i.exec(stderr ?? '');
  if (retryAfter) return Number(retryAfter[1]);
  const reset = /x-ratelimit-reset:\s*(\d+)/i.exec(stderr ?? '');
  if (reset) return Math.max(1, Math.ceil((Number(reset[1]) * 1000 - now) / 1000));
  // No header to read. A fixed minute is the documented floor for a secondary limit, and guessing
  // shorter is how a retry loop becomes the thing that keeps the limit alive.
  return 60;
}

/**
 * Read EVERY record from a paginated GitHub endpoint, or throw.
 *
 * `perPage` is appended when the endpoint does not already carry one, so a caller cannot accidentally
 * request page size 30 (the API default) and make the completeness check weaker than it looks.
 */
export function readWithBackoff(
  runner,
  args,
  endpoint,
  { attempts = 3, sleep = sleepSeconds } = {},
) {
  if (!Number.isInteger(attempts) || attempts < 1) {
    // A loop that never runs would fall through to the trailing throw and report a TypeError about
    // an undefined response — an error about the error, which tells the caller nothing.
    throw new Error(`${endpoint}: attempts must be a positive integer, got ${attempts}`);
  }
  let response;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    response = runner(args);
    if (response.status === 0) return response;
    const stderr = (response.stderr ?? '').trim();
    if (!isRateLimited(stderr)) break;
    if (attempt === attempts) {
      throw new Error(
        `${endpoint}: rate limited by the GitHub API and still limited after ${attempts} attempts. ` +
          'This is a budget to wait out, not a defect to work around — do not retry in a tighter ' +
          `loop. Last response: ${stderr || 'no stderr'}`,
      );
    }
    sleep(retryDelaySeconds(stderr));
  }
  throw new Error(
    `${endpoint}: \`gh api\` failed (exit ${response.status}): ` +
      `${(response.stderr ?? '').trim() || 'no stderr'}` +
      // INFRA-103: the failure said WHICH endpoint but never WHAT IT ASKED. A 422 on this repo's
      // `issues/{n}/labels` read cost an afternoon precisely because the message could not
      // distinguish this reader's request from the plain `gh api --paginate` call one step earlier
      // that succeeded on the same endpoint in the same job — the flags are the only difference and
      // they were the one thing not reported. Args cost a line and are the first thing anyone asks.
      `\n  requested: gh ${(args ?? []).join(' ')}` +
      `\n  gh: ${ghVersion()}`,
  );
}

/** Blocking sleep, so the synchronous `spawnSync` read path can wait without a rewrite. */
function sleepSeconds(seconds) {
  spawnSync(process.execPath, ['-e', `setTimeout(()=>{}, ${Math.max(0, seconds) * 1000})`]);
}

export function fetchAllPages(endpoint, { perPage = DEFAULT_PER_PAGE, runner = ghRunner } = {}) {
  const withPageSize = /[?&]per_page=/.test(endpoint)
    ? endpoint
    : `${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=${perPage}`;
  const declared = /[?&]per_page=(\d+)/.exec(withPageSize);
  const effectivePerPage = declared ? Number(declared[1]) : perPage;

  const response = readWithBackoff(
    runner,
    ['api', '--paginate', '--slurp', withPageSize],
    endpoint,
  );

  let pages;
  try {
    pages = JSON.parse(response.stdout);
  } catch (error) {
    // A zero exit with unparseable stdout is a real shape (an auth prompt, an HTML error page, a
    // proxy interstitial). Reported as itself rather than as an opaque SyntaxError.
    throw new Error(
      `${endpoint}: \`gh api\` returned unparseable output (${error.message}): ` +
        `${(response.stdout ?? '').slice(0, 300)}`,
    );
  }

  const { records, total, pageSizes, itemsKey } = mergePages(pages, { endpoint });
  assertComplete({ records, total, pageSizes, perPage: effectivePerPage, endpoint });
  return { records, total, pages: pageSizes.length, itemsKey };
}

function main(argv) {
  const endpoint = argv.find((arg) => !arg.startsWith('--'));
  if (!endpoint) {
    console.error('usage: github-api.mjs <endpoint> [--per-page N] [--jq <expr>]');
    process.exit(2);
  }
  const perPageIdx = argv.indexOf('--per-page');
  const jqIdx = argv.indexOf('--jq');
  const perPage = perPageIdx === -1 ? DEFAULT_PER_PAGE : Number(argv[perPageIdx + 1]);

  let result;
  try {
    result = fetchAllPages(endpoint, { perPage });
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }

  const json = JSON.stringify(result.records);
  if (jqIdx === -1) {
    console.log(json);
    return;
  }
  const jq = spawnSync('jq', ['-r', argv[jqIdx + 1]], {
    input: json,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (jq.status !== 0) {
    console.error(`::error::jq failed: ${(jq.stderr ?? '').trim()}`);
    process.exit(1);
  }
  process.stdout.write(jq.stdout);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main(process.argv.slice(2));
}
