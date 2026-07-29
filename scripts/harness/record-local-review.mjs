#!/usr/bin/env node
/**
 * Record that the local diff was reviewed at a specific commit.
 *
 * ## Why this exists
 *
 * `pr-review-orchestration` used to wait for required checks to go green before its FIRST review
 * round — so the reviewer only ever saw a diff that had already been pushed, opened as a PR, and
 * run through CI. Every finding therefore cost a push → CI round trip before anyone could even
 * look at it.
 *
 * Measured across one session (2026-07-28), PRs #1514/#1518/#1519/#1520/#1521: 38 review rounds,
 * 24 of them carrying a blocking finding, at roughly 6–10 minutes of CI per round. Not one of those
 * findings needed CI to be visible — every one was read out of the diff. Several were regressions
 * introduced by the previous round's fix, which a review of the next diff would have caught just as
 * cheaply.
 *
 * The reviewer agent already accepts a local diff (`git diff origin/<base>...HEAD`). Only the
 * orchestration's precondition forced the round trip. This file is the mechanical half of moving
 * that round before the push: `pre-push-check` refuses to push a feature branch whose HEAD has not
 * been reviewed, and this is how a review is recorded.
 *
 * ## What it does NOT claim
 *
 * A record says a review RAN at this commit and reported zero gating findings. It cannot say the
 * review was good — that is the reviewer's job, and a hook pretending to judge it would be a guard
 * measuring the wrong thing. Its value is that the round happens before the push rather than after,
 * which is where the eight minutes are.
 *
 * Usage:
 *   node scripts/harness/record-local-review.mjs --findings 0 [--notes "..."]
 *   node scripts/harness/record-local-review.mjs --show
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * The repository this invocation is about — resolved from the CALLER's directory, not from where
 * this file lives. `pre-push-check` runs in whatever checkout the push targets, which may be a
 * worktree; keying off the script's own location would record and read the main clone's state while
 * judging another one.
 */
function repoRoot(cwd = process.cwd()) {
  try {
    return git(['rev-parse', '--show-toplevel'], cwd);
  } catch {
    return SCRIPT_ROOT;
  }
}

export const RECORD_DIR = path.join(SCRIPT_ROOT, '.agents/local-reviews');

function recordDirFor(root) {
  return path.join(root, '.agents/local-reviews');
}

/** The record path for a branch. Slashes become `__` so the name stays one file. */
export function recordPathFor(branch, dir = RECORD_DIR) {
  return path.join(dir, `${branch.replace(/\//g, '__')}.json`);
}

/**
 * The verdict, with the reason — the single place the question is answered.
 *
 * `--show` used to re-implement these same checks beside `isReviewed()`, which is the duplicated
 * drift this change spent two rounds removing from the bash side. Two implementations agree until
 * one of them changes, and the JS pair was no different from the bash pair.
 *
 * Keyed on the HEAD sha, deliberately: amending or adding a commit changes what would be pushed, so
 * the previous round's review no longer describes it. That is the property the whole change is
 * about — a review must have seen what is being sent.
 */
export function reviewState(branch, headSha, dir = RECORD_DIR) {
  const file = recordPathFor(branch, dir);
  if (!existsSync(file)) {
    return {
      ok: false,
      reason: `no local review recorded for ${branch} at ${headSha.slice(0, 9)}`,
    };
  }
  let stored;
  try {
    stored = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // An unreadable record is not a review. Refuses rather than passes.
    return {
      ok: false,
      reason: `the review record for ${branch} is unreadable, so it is not a review`,
    };
  }
  if (stored.headSha !== headSha) {
    const seen = String(stored.headSha ?? '?').slice(0, 9);
    return { ok: false, reason: `last reviewed ${seen} — the diff has changed since` };
  }
  if (stored.findings !== 0) {
    const n = stored.findings ?? 'an unreadable number of';
    return { ok: false, reason: `the recorded review reports ${n} finding(s) still open` };
  }
  return { ok: true, reason: `reviewed at ${headSha.slice(0, 9)} — 0 findings` };
}

/** Convenience predicate over {@link reviewState}. */
export function isReviewed(branch, headSha, dir = RECORD_DIR) {
  return reviewState(branch, headSha, dir).ok;
}

function parseArgs(argv) {
  const args = { findings: null, notes: '', show: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--show') args.show = true;
    else if (argv[i] === '--findings') args.findings = Number(argv[++i]);
    else if (argv[i] === '--notes') args.notes = String(argv[++i] ?? '');
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const branch = git(['branch', '--show-current'], root);
  const headSha = git(['rev-parse', 'HEAD'], root);

  // A record is keyed by branch, so a detached HEAD has no key: every detached invocation would
  // share `.agents/local-reviews/.json` and satisfy the gate for every other. `pre-push-check` had
  // this guard and this file did not, which is exactly the split this file's docstring says it
  // exists to prevent — the owner of the verdict must own the whole of it.
  if (!branch) {
    console.error(
      'record-local-review: HEAD is detached, so a review cannot be keyed to a branch.',
    );
    console.error('Check out the branch this commit belongs to and run it again.');
    process.exit(1);
  }

  if (args.show) {
    // The single owner of "is this commit reviewed". `pre-push-check` calls this and routes on the
    // exit code rather than re-parsing the record in bash — the duplicated-logic drift this whole
    // change is about, which the first version of that hook reproduced.
    const verdict = reviewState(branch, headSha, recordDirFor(root));
    console.log(verdict.reason);
    process.exit(verdict.ok ? 0 : 1);
  }

  if (!Number.isInteger(args.findings) || args.findings < 0) {
    console.error(
      'record-local-review: --findings <n> is required (n = unresolved MUST + SHOULD).',
    );
    console.error('This is the reviewer’s own count. Record it; do not estimate it.');
    process.exit(1);
  }

  if (args.findings > 0) {
    // Recording an unresolved review would make the gate a formality. The point of the round is to
    // reach zero BEFORE the push, not to log that it was not reached.
    console.error(
      `record-local-review: ${args.findings} finding(s) still open — nothing to record yet.`,
    );
    console.error('Resolve them, review again, then record. The round is what saves the CI trip.');
    process.exit(1);
  }

  mkdirSync(recordDirFor(root), { recursive: true });
  const record = {
    branch,
    headSha,
    findings: 0,
    notes: args.notes,
    reviewedAt: new Date().toISOString(),
  };
  writeFileSync(recordPathFor(branch, recordDirFor(root)), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`recorded: ${branch} @ ${headSha.slice(0, 9)} — 0 findings`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
