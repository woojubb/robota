#!/usr/bin/env node

/**
 * INFRA-104 — derive the closing keywords a `develop → main` promotion must carry.
 *
 * ## Why this exists
 *
 * GitHub interprets a closing keyword only on a pull request that targets the DEFAULT branch:
 * "If the pull request targets any other branch, then these keywords are ignored, no links are
 * created, and merging the PR has no effect on the issues."
 * <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue>
 *
 * The default branch here is `main`, and `git-branch.md` routes every change feature → develop → main.
 * So the `Closes #N` that work pull requests already write is ignored on all of them, and the ONLY
 * pull request that targets the default branch — the promotion — carries no keyword of its own.
 * Measured 2026-08-17: PR #1802 (`Closes #1750`) and PR #1816 (`Closes #1722`) had both merged and
 * both issues were still open. Closing was being done by hand, in batches (PR #1804), days late, and
 * the stale queue then fed the session-start hook two finished items as top priorities.
 *
 * GitLab binds auto-close to the default branch the same way
 * (<https://docs.gitlab.com/administration/issue_closing_pattern/>), so this is not a GitHub quirk to
 * route around — a two-branch flow is expected to bridge it at the release boundary, which is where
 * `@semantic-release/github` also places it. `promote.mjs` IS that boundary here.
 *
 * ## Two facts the derivation is built on, both measured before it was written
 *
 *  1. **The keyword lives in the pull-request BODY, not the commit.** `git log -1 --format=%B
 *     93d061dd3` — the squash of PR #1802 — contains no `Closes` line: GitHub's squash body is the
 *     concatenated commit messages, not the pull-request description. So the derivation reaches the
 *     bodies through the `(#NNNN)` suffix GitHub appends to every squash subject. Reading commit
 *     messages instead would return an empty block that looks exactly like a clean promotion.
 *  2. **A `Closes` target is not always an issue.** PR #1801's body opens `Closes PROV-007.` — a Task
 *     ID — and a `#N` may name a pull request. Only a `#<digits>` that the API confirms is an OPEN
 *     ISSUE contributes a line.
 *
 * ## Fail closed, loudly
 *
 * An unreadable pull-request body or issue state THROWS. It never shortens the block. A short block
 * and a clean one are indistinguishable to whoever pastes it, which is the same silent-truncation
 * shape SEC-006 measured on the alerts endpoint — the failure that produced a reported all-clear
 * while 40 high-severity alerts were open.
 *
 * Usable two ways — as a module (the pure functions below) and as a CLI:
 *
 *   node scripts/harness/promotion-closes.mjs --base <ref> --head <ref>
 */

import { spawnSync } from 'node:child_process';

import { readWithBackoff } from './github-api.mjs';

/**
 * GitHub's closing keywords, all three families and every inflection it accepts.
 * `\b#(\d+)\b` binds to a NUMBER, which is what keeps `Closes PROV-007` out.
 */
const CLOSING_KEYWORD = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;

/** GitHub appends ` (#N)` to the subject of every squash merge. Anchored to the END of the line. */
const TRAILING_PULL_REFERENCE = /\(#(\d+)\)\s*$/;

/** The heading the promotion pull-request body carries above the derived lines. */
export const BLOCK_HEADING = '## Issues this promotion closes';

/**
 * Pull-request numbers for the commits a promotion carries, in the order given.
 *
 * Only the TRAILING `(#N)` counts: a subject may mention an issue mid-sentence ("undo the change
 * from #1409"), and that is a cross-reference, not the pull request the commit came from.
 *
 * @param {string[]} subjects one commit subject per entry, newest first
 * @returns {number[]}
 */
export function parsePullRequestNumbers(subjects) {
  const numbers = [];
  for (const subject of subjects) {
    const match = TRAILING_PULL_REFERENCE.exec(String(subject));
    if (match) numbers.push(Number(match[1]));
  }
  return numbers;
}

/**
 * Every `#<digits>` a body marks with a closing keyword, de-duplicated, first occurrence first.
 *
 * @param {string} body a pull-request body
 * @returns {number[]}
 */
export function extractIssueReferences(body) {
  const seen = new Set();
  const found = [];
  for (const match of String(body ?? '').matchAll(CLOSING_KEYWORD)) {
    const number = Number(match[1]);
    if (seen.has(number)) continue;
    seen.add(number);
    found.push(number);
  }
  return found;
}

/* -------------------------------------------------- examined-size provenance */

// Two populations are walked, so two numbers are reported (measurement-provenance.md clause 2): the
// pull-request bodies read, and the issue records checked. Each is incremented AT the read, not
// taken from the length of a result — a collection loses every duplicate and every filtered entry,
// which is exactly where a coverage claim would over-read.
let examinedPullBodies = 0;
let examinedIssueRecords = 0;

/** How many pull-request bodies the last collection READ. */
export function examinedPullBodyCount() {
  return examinedPullBodies;
}

/** How many issue records the last collection CHECKED. */
export function examinedIssueRecordCount() {
  return examinedIssueRecords;
}

/**
 * Derive the `Closes #N` lines a promotion body must carry.
 *
 * @param {object} input
 * @param {number[]} input.pullNumbers        pull requests the promotion carries, newest first
 * @param {(n: number) => string} input.readPullBody      MUST throw when the body cannot be read
 * @param {(n: number) => {state: string, isPullRequest: boolean}} input.readIssueState
 *        MUST throw when the record cannot be read
 * @returns {{lines: string[], issues: number[]}}
 */
export function collectClosingLines({ pullNumbers, readPullBody, readIssueState }) {
  examinedPullBodies = 0;
  examinedIssueRecords = 0;
  const candidates = [];
  const seen = new Set();

  for (const pullNumber of pullNumbers) {
    let body;
    try {
      body = readPullBody(pullNumber);
    } catch (error) {
      // Not a fallback: "I could not read it" and "it referenced nothing" are the two answers this
      // module exists to keep apart, and only one of them may produce a shorter block.
      throw new Error(
        `promotion-closes: could not read the body of pull request #${pullNumber} ` +
          `(${error.message}). The block is NOT emitted — a short block reads as a clean promotion.`,
      );
    }
    examinedPullBodies += 1;
    for (const issueNumber of extractIssueReferences(body)) {
      if (seen.has(issueNumber)) continue;
      seen.add(issueNumber);
      candidates.push(issueNumber);
    }
  }

  const issues = [];
  for (const issueNumber of candidates) {
    let record;
    try {
      record = readIssueState(issueNumber);
    } catch (error) {
      throw new Error(
        `promotion-closes: could not read the state of #${issueNumber} (${error.message}). ` +
          'The block is NOT emitted.',
      );
    }
    examinedIssueRecords += 1;
    // A pull request is reachable through the issues endpoint and must never be "closed" here; an
    // already-closed issue contributes nothing. Both are filters over a fully-read input.
    if (record?.isPullRequest) continue;
    if (String(record?.state).toLowerCase() !== 'open') continue;
    issues.push(issueNumber);
  }

  return { lines: issues.map((n) => `Closes #${n}`), issues };
}

/**
 * Render the block for pasting into the promotion pull-request body.
 * An empty derivation renders NOTHING — not an empty heading, which would read as a claim.
 *
 * @param {string[]} lines
 * @returns {string}
 */
export function renderBlock(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return '';
  return `${BLOCK_HEADING}\n\n${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------------ CLI */

function gitSubjects(base, head) {
  const result = spawnSync('git', ['log', '--format=%s', `${base}..${head}`], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `promotion-closes: \`git log ${base}..${head}\` failed (${result.stderr?.trim() || 'no stderr'})`,
    );
  }
  return result.stdout.split('\n').filter((line) => line.trim() !== '');
}

function ghRunner(args) {
  return spawnSync('gh', args, { encoding: 'utf8' });
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
  const args = { base: 'main', head: 'HEAD', repo: process.env.GITHUB_REPOSITORY };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base') args.base = argv[++i];
    else if (argv[i] === '--head') args.head = argv[++i];
    else if (argv[i] === '--repo') args.repo = argv[++i];
    else throw new Error(`promotion-closes: unknown argument \`${argv[i]}\``);
  }
  return args;
}

/**
 * The live GitHub readers, as the pair `collectClosingLines` expects. Exported so `promote.mjs` reuses
 * this one implementation rather than growing a second copy that can drift from it.
 *
 * @param {string} repo `owner/name`
 */
export function createGitHubReaders(repo) {
  return {
    readPullBody: (n) => readPullBodyViaApi(repo, n),
    readIssueState: (n) => readIssueStateViaApi(repo, n),
  };
}

export function resolveRepository(explicit) {
  if (explicit) return explicit;
  const result = spawnSync(
    'gh',
    ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
    {
      encoding: 'utf8',
    },
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error('promotion-closes: could not resolve the repository (pass --repo owner/name)');
  }
  return result.stdout.trim();
}

export async function main(argv = process.argv.slice(2)) {
  const { base, head, repo: explicitRepo } = parseArgs(argv);
  const repo = resolveRepository(explicitRepo);
  const pullNumbers = parsePullRequestNumbers(gitSubjects(base, head));
  const { lines } = collectClosingLines({ pullNumbers, ...createGitHubReaders(repo) });
  const block = renderBlock(lines);
  if (block) process.stdout.write(block);
  console.error(
    `::examined:: ${examinedPullBodyCount()} pull-request body(ies) read, ` +
      `${examinedIssueRecordCount()} issue record(s) checked`,
  );
  return 0;
}

const isDirectExecution =
  process.argv[1] !== undefined && process.argv[1].endsWith('promotion-closes.mjs');
if (isDirectExecution) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
