#!/usr/bin/env node

/**
 * INFRA-104 — a promotion pull request must carry the closing keywords its commits imply.
 *
 * `promotion-closes.mjs` derives the block. This is what makes anyone paste it.
 *
 * ## Why a guard and not a convention
 *
 * The promotion body is composed by hand from `promote.mjs`'s output. A body that silently omits a
 * keyword closes nothing, and it is INDISTINGUISHABLE from a promotion that genuinely had nothing to
 * close. That is the same shape the derivation itself fails closed against, one layer up — and this
 * repository has already paid for it twice (SEC-006's false all-clear, INFRA-048's advisory reviewer
 * that reported `success` without having run).
 *
 * This is a REQUIRED status check on `protect-main` (owner decision D1, 2026-08-18). That places a
 * duty on it: it must be able to FAIL on a real `main` pull request. Five required contexts on
 * promotion #1427 were no-ops whose every real step was gated off for `base_ref == 'main'`
 * (INFRA-055), and branch protection reported green from jobs that deliberately did no work. So this
 * job runs its full check exactly when the base IS `main`, and reports NOT APPLICABLE — a pass —
 * only for a base that is not the default branch, where GitHub would ignore the keywords anyway.
 *
 * Usage:
 *   node scripts/harness/scan-promotion-closes.mjs --pr <n> [--repo owner/name] [--default-branch main]
 *
 * Exit 0 = clean or not applicable, 1 = blocked.
 */

import { spawnSync } from 'node:child_process';

import { readWithBackoff } from './github-api.mjs';
import {
  collectClosingLines,
  createGitHubReaders,
  resolveLandingPullNumbers,
} from './promotion-closes.mjs';

/** Sentinel a caller passes when the requirement could not be derived. Blocks, never passes. */
export const UNAVAILABLE = 'UNAVAILABLE';

/* -------------------------------------------------- examined-size provenance */

// Incremented inside the walk over the requirement, not read off its length: the requirement is what
// this guard CHECKED, and a length taken from the input describes the input whether the walk ran or
// not (measurement-provenance.md clause 1).
let examinedIssues = 0;

/** How many required issues the last verdict CHECKED the body against. */
export function examinedIssueCount() {
  return examinedIssues;
}

/**
 * Issues the body fails to close.
 *
 * Any closing-keyword inflection counts — the guard checks that the issue WILL close, not that the
 * body was copied verbatim from the deriver. A bare cross-reference does not count, because it
 * closes nothing.
 *
 * @param {{body: string, requiredIssues: number[]}} input
 * @returns {number[]}
 */
export function findMissingKeywords({ body, requiredIssues }) {
  examinedIssues = 0;
  const text = String(body ?? '');
  return (requiredIssues ?? []).filter((issueNumber) => {
    examinedIssues += 1;
    // `\b#N\b` — the trailing boundary is what keeps `#172` from satisfying a requirement for `#1722`.
    const pattern = new RegExp(
      `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${issueNumber}\\b`,
      'i',
    );
    return !pattern.test(text);
  });
}

/**
 * The verdict.
 *
 * @param {object} input
 * @param {string} input.baseRef            the pull request's base branch
 * @param {string} input.body               the pull request body
 * @param {number[]|'UNAVAILABLE'} input.requiredIssues
 * @param {string} [input.defaultBranch]
 * @returns {{applicable: boolean, blocked: boolean, missing: number[], summary: string}}
 */
export function decidePromotionCloses({ baseRef, body, requiredIssues, defaultBranch = 'main' }) {
  // Both early returns below leave the walk unrun, and a stale count from a previous verdict would
  // be published as this one's coverage.
  examinedIssues = 0;
  if (baseRef !== defaultBranch) {
    return {
      applicable: false,
      blocked: false,
      missing: [],
      summary:
        `not applicable: base is \`${baseRef}\`, not \`${defaultBranch}\`. GitHub reads closing ` +
        'keywords only on a default-branch pull request, so none is owed here.',
    };
  }

  if (requiredIssues === UNAVAILABLE) {
    return {
      applicable: true,
      blocked: true,
      missing: [],
      summary:
        'BLOCKED: the set of issues this promotion closes could not be derived. An underivable ' +
        'requirement is not an empty one — passing here would report a clean promotion on an ' +
        'unanswered question.',
    };
  }

  const missing = findMissingKeywords({ body, requiredIssues });
  if (missing.length > 0) {
    return {
      applicable: true,
      blocked: true,
      missing,
      summary:
        `BLOCKED: the promotion body does not close ${missing.map((n) => `#${n}`).join(', ')}. ` +
        'Those issues are closed by pull requests this promotion carries, and `main` is the only ' +
        'branch on which GitHub acts on a closing keyword. Add the lines `promote.mjs` printed.',
    };
  }

  return {
    applicable: true,
    blocked: false,
    missing: [],
    summary: `clean: the promotion body closes all ${requiredIssues.length} issue(s) its commits imply.`,
  };
}

/* ------------------------------------------------------------------ CLI */

function ghRunner(args) {
  return spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** allow-unpaginated: a pull request by number is ONE resource, not a collection; no count derived. */
function readPull(repo, pullNumber) {
  const response = readWithBackoff(
    ghRunner,
    [
      'api',
      `repos/${repo}/pulls/${pullNumber}`,
      '--jq',
      '{base: .base.ref, baseOid: .base.sha, headOid: .head.sha, body: (.body // "")}',
    ],
    `pulls/${pullNumber}`,
  );
  return JSON.parse(response.stdout);
}

function readCommitParents(repo, oid) {
  const response = readWithBackoff(
    ghRunner,
    ['api', `repos/${repo}/commits/${oid}`, '--jq', '[.parents[].sha]'],
    `commits/${oid}`,
  );
  return JSON.parse(response.stdout);
}

export function promotionDevelopHead({ headOid, baseOid, parents }) {
  if (parents.length !== 2 || parents.some((oid) => !/^[0-9a-f]{40}$/i.test(oid))) {
    throw new Error(
      `promotion head ${headOid} must be the sanctioned two-parent merge; found ${parents.length} parent(s)`,
    );
  }
  if (parents[1] !== baseOid) {
    throw new Error(
      `promotion head ${headOid} must record base ${baseOid} as its second parent; found ${parents[1]}`,
    );
  }
  return parents[0];
}

export function comparisonFirstParentLandingOids({ headOid, pages }) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('promotion comparison returned no pages');
  }
  const mergeBase = pages[0]?.merge_base_commit?.sha;
  const total = pages[0]?.total_commits;
  const commits = pages.flatMap((page) => (Array.isArray(page?.commits) ? page.commits : []));
  if (!/^[0-9a-f]{40}$/i.test(mergeBase ?? '')) {
    throw new Error('promotion comparison returned no full merge-base OID');
  }
  if (!Number.isSafeInteger(total) || total < 0 || commits.length !== total) {
    throw new Error(
      `promotion comparison is incomplete: expected ${String(total)}, read ${commits.length} commit(s)`,
    );
  }
  const byOid = new Map(
    commits.map((commit) => [
      commit.sha,
      Array.isArray(commit.parents) ? commit.parents.map((parent) => parent.sha) : [],
    ]),
  );
  const landingOids = [];
  const seen = new Set();
  let current = headOid;
  while (current !== mergeBase) {
    if (seen.has(current)) throw new Error(`promotion comparison first-parent cycle at ${current}`);
    seen.add(current);
    const parents = byOid.get(current);
    if (!parents || !/^[0-9a-f]{40}$/i.test(parents[0] ?? '')) {
      throw new Error(`promotion comparison cannot continue first-parent walk from ${current}`);
    }
    landingOids.push(current);
    current = parents[0];
  }
  return landingOids;
}

function comparisonLandingOids(repo, baseOid, headOid) {
  const endpoint = `repos/${repo}/compare/${baseOid}...${headOid}?per_page=100`;
  const response = readWithBackoff(ghRunner, ['api', '--paginate', '--slurp', endpoint], endpoint);
  let pages;
  try {
    pages = JSON.parse(response.stdout);
  } catch (error) {
    throw new Error(`promotion comparison returned invalid JSON: ${error.message}`);
  }
  return comparisonFirstParentLandingOids({ headOid, pages });
}

/**
 * Legacy subject decoder retained for focused compatibility tests.
 *
 * The encoding is not decoration. `--jq '.[].commit.message'` prints a scalar RAW, so a squash
 * message's body arrives as further lines of stdout and every one of them reads as another commit's
 * subject. A body line that happens to end in `(#123)` — quoting another pull request, which a
 * promotion body routinely does — could otherwise be mistaken for a carried pull request. The
 * production guard now resolves first-parent landing OIDs through GitHub instead; `@json` keeps this
 * historical decoder's old input shape explicit and testable.
 */
export function parseCommitSubjects(stdout) {
  return (stdout ?? '')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        // Fail loudly: the caller turns a throw into UNAVAILABLE, which BLOCKS. Guessing at a
        // half-decoded line would let a mis-parse read as "no pull requests carried" — a pass.
        throw new Error(`commit message line is not JSON-encoded: ${line.slice(0, 80)}`);
      }
      if (typeof message !== 'string') {
        throw new Error(`commit message is not a string: ${line.slice(0, 80)}`);
      }
      return message.split('\n')[0].trim();
    })
    .filter((subject) => subject !== '');
}

function parseArgs(argv) {
  const args = {
    pr: undefined,
    repo: process.env.GITHUB_REPOSITORY,
    defaultBranch: 'main',
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--pr') args.pr = Number(argv[++i]);
    else if (argv[i] === '--repo') args.repo = argv[++i];
    else if (argv[i] === '--default-branch') args.defaultBranch = argv[++i];
    else throw new Error(`scan-promotion-closes: unknown argument \`${argv[i]}\``);
  }
  if (!Number.isInteger(args.pr) || args.pr <= 0) {
    throw new Error('scan-promotion-closes: --pr <n> is required');
  }
  if (!args.repo) {
    throw new Error(
      'scan-promotion-closes: --repo owner/name is required (or set GITHUB_REPOSITORY)',
    );
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const { pr, repo, defaultBranch } = parseArgs(argv);
  const pull = readPull(repo, pr);

  // UNAVAILABLE is the STARTING value, and it survives every path that does not actually derive a
  // requirement: a base that is not the default branch (where `decidePromotionCloses` answers
  // not-applicable before it reads this at all) and a derivation that threw. Assigning `[]` on the
  // non-default-branch path — as this did — made the sentinel a dead store, which is what CodeQL
  // reported, and left "nothing to close" one edit away from being the answer on a path that never
  // looked.
  let requiredIssues = UNAVAILABLE;
  if (pull.base === defaultBranch) {
    try {
      const readers = createGitHubReaders(repo);
      const developHead = promotionDevelopHead({
        headOid: pull.headOid,
        baseOid: pull.baseOid,
        parents: readCommitParents(repo, pull.headOid),
      });
      const carried = resolveLandingPullNumbers({
        landingOids: comparisonLandingOids(repo, pull.baseOid, developHead),
        baseRefName: 'develop',
        readAssociatedPull: readers.readAssociatedPull,
      });
      requiredIssues = collectClosingLines({
        pullNumbers: carried,
        ...readers,
      }).issues;
    } catch (error) {
      // Deliberately NOT rethrown as a crash: `requiredIssues` is left at UNAVAILABLE so the
      // decision module reports the reason as a verdict on the pull request, rather than leaving it
      // in a runner annotation only.
      console.error(`scan-promotion-closes: ${error.message}`);
    }
  }

  const verdict = decidePromotionCloses({
    baseRef: pull.base,
    body: pull.body,
    requiredIssues,
    defaultBranch,
  });
  console.log(`promotion-closes: ${verdict.summary}`);
  console.error(
    `::examined:: pull request #${pr} (base \`${pull.base}\`), ` +
      `${verdict.applicable ? `${examinedIssueCount()} implied issue(s) checked` : 'not applicable'}`,
  );
  return verdict.blocked ? 1 : 0;
}

const isDirectExecution =
  process.argv[1] !== undefined && process.argv[1].endsWith('scan-promotion-closes.mjs');
if (isDirectExecution) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
