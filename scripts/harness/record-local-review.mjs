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

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const RECORD_DIR = path.join(WORKSPACE_ROOT, '.agents/local-reviews');

function git(args, cwd = WORKSPACE_ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** The record path for a branch. Slashes become `__` so the name stays one file. */
export function recordPathFor(branch, dir = RECORD_DIR) {
  return path.join(dir, `${branch.replace(/\//g, '__')}.json`);
}

/**
 * Has the given commit been reviewed on this branch?
 *
 * Keyed on the HEAD sha, deliberately: amending or adding a commit changes what would be pushed, so
 * the previous round's review no longer describes it. That is the property the whole change is
 * about — a review must have seen what is being sent.
 */
export function isReviewed(branch, headSha, dir = RECORD_DIR) {
  const file = recordPathFor(branch, dir);
  if (!existsSync(file)) return false;
  try {
    const record = JSON.parse(readFileSync(file, 'utf8'));
    return record.headSha === headSha && record.findings === 0;
  } catch {
    // An unreadable record is not a review. Treated as absent, which refuses rather than passes.
    return false;
  }
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
  const branch = git(['branch', '--show-current']);
  const headSha = git(['rev-parse', 'HEAD']);

  if (args.show) {
    const file = recordPathFor(branch);
    if (!existsSync(file)) {
      console.log(`no local review recorded for ${branch} (HEAD ${headSha.slice(0, 9)})`);
      process.exit(1);
    }
    console.log(readFileSync(file, 'utf8'));
    process.exit(isReviewed(branch, headSha) ? 0 : 1);
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

  mkdirSync(RECORD_DIR, { recursive: true });
  const record = {
    branch,
    headSha,
    findings: 0,
    notes: args.notes,
    reviewedAt: new Date().toISOString(),
  };
  writeFileSync(recordPathFor(branch), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`recorded: ${branch} @ ${headSha.slice(0, 9)} — 0 findings`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
