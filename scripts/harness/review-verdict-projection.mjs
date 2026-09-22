#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';

const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

function laterThan(left, right) {
  return left.at.localeCompare(right.at) > 0 || (left.at === right.at && left.id > right.id);
}

function delegatedVerdict(review, head) {
  const lines = String(review.body ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0] !== 'INDEPENDENT_REVIEW') return null;
  const fields = new Map();
  for (const line of lines.slice(1)) {
    const match = /^(REVIEWER|REVIEWED HEAD|ACTIONABLE FINDINGS):\s*(.+)$/u.exec(line);
    if (!match || fields.has(match[1])) return null;
    fields.set(match[1], match[2]);
  }
  if (fields.size !== 3) return null;
  if (!/^agent:[A-Za-z0-9._/-]+$/u.test(fields.get('REVIEWER'))) return null;
  if (fields.get('REVIEWED HEAD') !== head) return null;
  const findings = Number(fields.get('ACTIONABLE FINDINGS'));
  if (!Number.isSafeInteger(findings) || findings < 0) return null;
  return { kind: 'delegated', findings };
}

/** Canonical exact-head, latest-per-reviewer projection consumed by CI and the push freeze. */
export function projectReviewVerdict({ reviews, head, prAuthor }) {
  if (!Array.isArray(reviews) || !/^[0-9a-f]{40}$/iu.test(head ?? '')) {
    throw new TypeError('review verdict projection input is invalid');
  }
  const latestByReviewer = new Map();
  for (const review of reviews) {
    if (!TRUSTED_ASSOCIATIONS.has(review.author_association)) continue;
    const author = review.user?.login;
    if (!author || review.commit_id !== head) continue;

    let candidate = null;
    if (review.state === 'COMMENTED') {
      const delegated = delegatedVerdict(review, head);
      if (delegated) candidate = { ...delegated };
    } else if (review.state === 'APPROVED' && author !== prAuthor) {
      candidate = { kind: 'approval', findings: 0 };
    } else if (review.state === 'CHANGES_REQUESTED') {
      candidate = { kind: 'changes-requested', findings: 1 };
    } else if (review.state === 'DISMISSED') {
      candidate = { kind: 'dismissed' };
    }
    if (!candidate) continue;
    candidate = {
      ...candidate,
      at: review.submitted_at ?? '',
      id: Number(review.id ?? 0),
      author,
      head,
    };
    const previous = latestByReviewer.get(author);
    if (!previous || laterThan(candidate, previous)) latestByReviewer.set(author, candidate);
  }

  const active = [...latestByReviewer.values()].filter(({ kind }) => kind !== 'dismissed');
  const blocker = active
    .filter(({ kind, findings }) => kind === 'changes-requested' || findings > 0)
    .sort((left, right) => left.at.localeCompare(right.at) || left.id - right.id)
    .at(-1);
  if (blocker) return { status: 'blocked', ...blocker };

  const accepted = active
    .filter(({ findings }) => findings === 0)
    .sort((left, right) => left.at.localeCompare(right.at) || left.id - right.id)
    .at(-1);
  return accepted ? { status: 'accepted', ...accepted } : { status: 'absent', head };
}

function flattenedReviews(file) {
  const parsed = JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8'));
  if (!Array.isArray(parsed)) throw new TypeError('reviews payload is not an array');
  return parsed.flat();
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  const head = argument('--head') ?? process.env.PR_HEAD;
  const prAuthor = argument('--author') ?? process.env.PR_AUTHOR;
  const file = argument('--reviews-file') ?? process.env.REVIEWS_FILE;
  const projected = projectReviewVerdict({ reviews: flattenedReviews(file), head, prAuthor });

  if (process.argv.includes('--project')) {
    if (projected.status === 'absent') {
      process.exitCode = 2;
      return;
    }
    process.stdout.write(
      `${projected.head}\t${projected.findings}\t${projected.kind}\t${projected.author}\n`,
    );
    return;
  }

  if (projected.status === 'blocked') {
    const detail =
      projected.kind === 'changes-requested'
        ? 'requests changes'
        : `reports ${projected.findings} actionable finding(s)`;
    console.error(
      `::error::review-policy: active exact-head review by ${projected.author} ${detail}.`,
    );
    process.exitCode = 1;
    return;
  }
  if (projected.status === 'absent') {
    console.error(
      `::error::review-policy: PR #${process.env.PR_NUMBER ?? 'unknown'} has no trusted independent review bound to head ${head}.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `review-policy: trusted ${projected.kind} review by ${projected.author} is bound to ${head} with zero findings.`,
  );
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
