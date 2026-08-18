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
import { collectClosingLines, parsePullRequestNumbers } from './promotion-closes.mjs';

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
  return spawnSync('gh', args, { encoding: 'utf8' });
}

/** allow-unpaginated: a pull request by number is ONE resource, not a collection; no count derived. */
function readPull(repo, pullNumber) {
  const response = readWithBackoff(
    ghRunner,
    ['api', `repos/${repo}/pulls/${pullNumber}`, '--jq', '{base: .base.ref, body: (.body // "")}'],
    `pulls/${pullNumber}`,
  );
  return JSON.parse(response.stdout);
}

function pullCommitSubjects(repo, pullNumber) {
  const response = readWithBackoff(
    ghRunner,
    [
      'api',
      '--paginate',
      `repos/${repo}/pulls/${pullNumber}/commits?per_page=100`,
      '--jq',
      '.[].commit.message',
    ],
    `pulls/${pullNumber}/commits`,
  );
  return (response.stdout ?? '')
    .split('\n')
    .map((message) => message.split('\\n')[0].trim())
    .filter((subject) => subject !== '');
}

/** allow-unpaginated: a pull request by number is ONE resource, not a collection; no count derived. */
function readPullBodyViaApi(repo, pullNumber) {
  const response = readWithBackoff(
    ghRunner,
    ['api', `repos/${repo}/pulls/${pullNumber}`, '--jq', '.body // ""'],
    `pulls/${pullNumber}`,
  );
  return response.stdout ?? '';
}

/** allow-unpaginated: an issue by number is ONE resource, not a collection; no count derived. */
function readIssueStateViaApi(repo, issueNumber) {
  const response = readWithBackoff(
    ghRunner,
    [
      'api',
      `repos/${repo}/issues/${issueNumber}`,
      '--jq',
      '{state: .state, isPullRequest: (has("pull_request"))}',
    ],
    `issues/${issueNumber}`,
  );
  return JSON.parse(response.stdout);
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

  let requiredIssues = UNAVAILABLE;
  if (pull.base === defaultBranch) {
    try {
      const carried = parsePullRequestNumbers(pullCommitSubjects(repo, pr));
      requiredIssues = collectClosingLines({
        pullNumbers: carried,
        readPullBody: (n) => readPullBodyViaApi(repo, n),
        readIssueState: (n) => readIssueStateViaApi(repo, n),
      }).issues;
    } catch (error) {
      // Deliberately NOT rethrown as a crash: the sentinel makes the decision module report the
      // reason as a verdict on the pull request, rather than leaving it in a runner annotation only.
      console.error(`scan-promotion-closes: ${error.message}`);
      requiredIssues = UNAVAILABLE;
    }
  } else {
    requiredIssues = [];
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
