import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const REVIEW_POLICY = readFileSync(path.join(ROOT, '.github/workflows/review-gate.yml'), 'utf8');
const CODEQL = readFileSync(path.join(ROOT, '.github/workflows/codeql.yml'), 'utf8');
const REVIEW_VERDICT = readFileSync(
  path.join(ROOT, 'scripts/harness/review-verdict-projection.mjs'),
  'utf8',
);

function jobBlock(source, job, nextJob) {
  const start = source.indexOf(`  ${job}:`);
  expect(start, `missing job ${job}`).toBeGreaterThanOrEqual(0);
  const end = nextJob ? source.indexOf(`\n  ${nextJob}:`, start + 1) : source.length;
  return source.slice(start, end < 0 ? undefined : end);
}

function permissionsBlock(job) {
  return /^    permissions:\n(?:      [^\n]+\n)+/m.exec(job)?.[0] ?? '';
}

describe('review-policy keeps analysis outside the required PR path', () => {
  it('re-evaluates edits, labels, and review events in one superseding PR lane', () => {
    expect(REVIEW_POLICY).toMatch(/types:\s*\[[^\]]*edited[^\]]*labeled[^\]]*unlabeled[^\]]*\]/);
    expect(REVIEW_POLICY).toMatch(
      /pull_request_review:[\s\S]*types:\s*\[submitted, edited, dismissed\]/,
    );
    expect(REVIEW_POLICY).toContain('group: review-policy-${{ github.event.pull_request.number }}');
    expect(REVIEW_POLICY).toMatch(/cancel-in-progress:\s*true/);
  });

  it('fails closed without a trusted exact-head independent review artifact', () => {
    const gate = jobBlock(REVIEW_POLICY, 'review-policy', 'disarm-auto-merge');
    expect(gate).toContain('pulls/${PR_NUMBER}/reviews?per_page=100');
    expect(gate).toContain('node scripts/harness/review-verdict-projection.mjs');
    expect(REVIEW_VERDICT).toContain("lines[0] !== 'INDEPENDENT_REVIEW'");
    expect(REVIEW_VERDICT).toContain("review.state === 'COMMENTED'");
    expect(REVIEW_VERDICT).toContain("review.state === 'APPROVED'");
    expect(REVIEW_VERDICT).toContain('review.commit_id !== head');
    expect(REVIEW_VERDICT).toContain("review.state === 'CHANGES_REQUESTED'");
    expect(REVIEW_VERDICT).toContain("kind === 'changes-requested'");
    expect(REVIEW_VERDICT).toContain('has no trusted independent review bound to head');
  });

  it('has no disabled classifier or analyzer predecessor chain', () => {
    const gate = jobBlock(REVIEW_POLICY, 'review-policy', 'disarm-auto-merge');

    expect(REVIEW_POLICY).not.toMatch(/^  (classify|analyze):/m);
    expect(gate).toMatch(/name:\s*review-policy/);
    expect(gate).not.toMatch(/^    needs:/m);
    expect(gate).not.toContain('cancelled()');
    expect(gate).not.toContain('needs.classify');
    expect(gate).not.toContain('needs.analyze');
    expect(gate).not.toContain('CODE_CHANGED');
    expect(gate).not.toContain('check-review-gate.mjs');
    expect(gate).toContain('github.event.pull_request.base.sha');
  });

  it('loads the policy judge from the base SHA and records workflow-provenance containment', () => {
    const gate = jobBlock(REVIEW_POLICY, 'review-policy', 'disarm-auto-merge');
    const headCheckout = gate.indexOf('ref: ${{ github.event.pull_request.head.sha }}');
    const reviewProjection = gate.indexOf('node scripts/harness/review-verdict-projection.mjs');
    const baseCheckout = gate.indexOf('ref: ${{ github.event.pull_request.base.sha }}');
    expect(headCheckout).toBeGreaterThanOrEqual(0);
    expect(reviewProjection).toBeGreaterThan(headCheckout);
    expect(baseCheckout).toBeGreaterThan(reviewProjection);
    expect(gate).toMatch(
      /uses:\s*actions\/checkout@v7[\s\S]*ref:\s*\$\{\{ github\.event\.pull_request\.base\.sha \}\}/,
    );
    expect(REVIEW_POLICY).toContain('Contained — INFRA-097');
  });

  it('keeps write authority isolated from the checked-out policy job', () => {
    const gate = jobBlock(REVIEW_POLICY, 'review-policy', 'disarm-auto-merge');
    const disarm = jobBlock(REVIEW_POLICY, 'disarm-auto-merge');

    expect(permissionsBlock(gate)).toMatch(/contents:\s*read/);
    expect(permissionsBlock(gate)).toMatch(/pull-requests:\s*read/);
    expect(permissionsBlock(gate)).not.toMatch(
      /security-events|contents:\s*write|pull-requests:\s*write/,
    );
    expect(permissionsBlock(disarm)).toMatch(/contents:\s*write/);
    expect(permissionsBlock(disarm)).toMatch(/pull-requests:\s*write/);
    expect(disarm).not.toContain('actions/checkout');
  });

  it('keeps standalone CodeQL push-only and outside required review policy', () => {
    expect(CODEQL).toMatch(/push:\s*\n\s*branches:\s*\[main, develop\]/);
    expect(CODEQL).not.toMatch(/pull_request:/);
    expect(REVIEW_POLICY).not.toContain('github/codeql-action');
    expect(REVIEW_POLICY).not.toContain('code-scanning/');
    expect(CODEQL).not.toContain('recover-review-gate');
    expect(CODEQL).not.toContain('actions: write');
    expect(CODEQL).not.toContain('gh run rerun');
  });
});
