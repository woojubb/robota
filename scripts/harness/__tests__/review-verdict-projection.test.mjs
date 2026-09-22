import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const EVALUATOR = path.join(ROOT, 'scripts/harness/review-verdict-projection.mjs');
const HEAD = 'a'.repeat(40);

function delegatedBody(head = HEAD, findings = 0) {
  return [
    'INDEPENDENT_REVIEW',
    'REVIEWER: agent:/root/reviewer',
    `REVIEWED HEAD: ${head}`,
    `ACTIONABLE FINDINGS: ${findings}`,
  ].join('\n');
}

function review({
  id,
  author = 'reviewer',
  state = 'COMMENTED',
  commit = HEAD,
  body = delegatedBody(),
  at = `2026-09-23T00:00:${String(id).padStart(2, '0')}Z`,
}) {
  return {
    id,
    user: { login: author },
    state,
    commit_id: commit,
    body,
    submitted_at: at,
    author_association: 'MEMBER',
  };
}

function evaluate(reviews) {
  const directory = makeTemp('robota-review-policy-');
  const reviewsFile = path.join(directory, 'reviews.json');
  writeFileSync(reviewsFile, JSON.stringify([reviews]));
  return spawnSync(process.execPath, [EVALUATOR], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PR_AUTHOR: 'author',
      PR_HEAD: HEAD,
      PR_NUMBER: '2826',
      REVIEWS_FILE: reviewsFile,
    },
  });
}

describe('review-policy exact-head verdict', () => {
  it('accepts a trusted COMMENTED delegated zero-finding verdict on the exact head', () => {
    expect(evaluate([review({ id: 1 })]).status).toBe(0);
  });

  it('rejects editing an old-commit review body to claim the current head', () => {
    const result = evaluate([review({ id: 1, commit: 'b'.repeat(40) })]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no trusted independent review bound to head');
  });

  it.each(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'])(
    'does not treat a strict marker carried by a %s review as a delegated verdict',
    (state) => {
      const result = evaluate([review({ id: 1, author: 'author', state })]);
      expect(result.status).toBe(1);
    },
  );

  it('blocks a later exact-head change request after an approval', () => {
    const result = evaluate([
      review({ id: 1, state: 'APPROVED', body: '' }),
      review({ id: 2, author: 'second-reviewer', state: 'CHANGES_REQUESTED', body: '' }),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('requests changes');
  });

  it('lets the same reviewer supersede a change request with a later approval', () => {
    const result = evaluate([
      review({ id: 1, state: 'CHANGES_REQUESTED', body: '' }),
      review({ id: 2, state: 'APPROVED', body: '' }),
    ]);
    expect(result.status).toBe(0);
  });

  it("does not retain a reviewer's approval after a later dismissal", () => {
    const result = evaluate([
      review({ id: 1, state: 'APPROVED', body: '' }),
      review({ id: 2, state: 'DISMISSED', body: '' }),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no trusted independent review bound to head');
  });

  it("keeps another reviewer's exact-head change request active", () => {
    const result = evaluate([
      review({ id: 1, author: 'blocking-reviewer', state: 'CHANGES_REQUESTED', body: '' }),
      review({ id: 2, state: 'APPROVED', body: '' }),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('blocking-reviewer');
  });
});
