import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const REVIEW_GATE = readFileSync(path.join(ROOT, '.github/workflows/review-gate.yml'), 'utf8');
const CODEQL = readFileSync(path.join(ROOT, '.github/workflows/codeql.yml'), 'utf8');

function jobBlock(source, job, nextJob) {
  const start = source.indexOf(`  ${job}:`);
  expect(start, `missing job ${job}`).toBeGreaterThanOrEqual(0);
  const end = nextJob ? source.indexOf(`\n  ${nextJob}:`, start + 1) : source.length;
  return source.slice(start, end < 0 ? undefined : end);
}

function permissionsBlock(job) {
  return /^    permissions:\n(?:      [^\n]+\n)+/m.exec(job)?.[0] ?? '';
}

describe('review-gate waits for same-workflow CodeQL (INFRA-096)', () => {
  it('handles base retargeting and separates label reevaluation from head analysis concurrency', () => {
    expect(REVIEW_GATE).toMatch(/types:\s*\[[^\]]*edited[^\]]*\]/);
    expect(REVIEW_GATE).toMatch(/github\.event\.action[\s\S]*labels[\s\S]*head/);
    expect(REVIEW_GATE).toMatch(/cancel-in-progress:\s*true/);
  });

  it('orders classify then analyze then the required review-gate context', () => {
    const classify = jobBlock(REVIEW_GATE, 'classify', 'analyze');
    const analyze = jobBlock(REVIEW_GATE, 'analyze', 'review-gate');
    const gate = jobBlock(REVIEW_GATE, 'review-gate', 'disarm-auto-merge');

    expect(classify).toMatch(/outputs:[\s\S]*code:/);
    expect(classify).toContain('classify-changed-paths.mjs');
    expect(classify).toContain('github.event.pull_request.base.sha');
    expect(classify).toContain('github.event.pull_request.head.sha');
    expect(analyze).toMatch(/needs:\s*classify/);
    expect(analyze).toMatch(/needs\.classify\.outputs\.code\s*==\s*'true'/);
    expect(analyze).toContain('github/codeql-action/analyze@v4');
    expect(gate).toMatch(/name:\s*review-gate/);
    expect(gate).toMatch(/needs:\s*\[classify, analyze\]/);
    expect(gate).toMatch(/if:\s*\$\{\{\s*!cancelled\(\)/);
    expect(gate).toContain("needs.classify.result != 'cancelled'");
    expect(gate).toContain("needs.analyze.result != 'cancelled'");
    expect(gate).toContain('needs.classify.outputs.code');
    expect(gate).toContain('needs.analyze.result');
    expect(gate).toContain('github.event.pull_request.base.sha');
  });

  it('loads governance scripts from base SHA and records the workflow-provenance containment', () => {
    const classify = jobBlock(REVIEW_GATE, 'classify', 'analyze');
    const analyze = jobBlock(REVIEW_GATE, 'analyze', 'review-gate');
    const gate = jobBlock(REVIEW_GATE, 'review-gate', 'disarm-auto-merge');
    expect(classify).toMatch(
      /uses:\s*actions\/checkout@v7[\s\S]*ref:\s*\$\{\{ github\.event\.pull_request\.base\.sha \}\}/,
    );
    expect(gate).toMatch(
      /uses:\s*actions\/checkout@v4[\s\S]*ref:\s*\$\{\{ github\.event\.pull_request\.base\.sha \}\}/,
    );
    expect(analyze).not.toContain('github.event.pull_request.base.sha');
    expect(REVIEW_GATE).toContain('Contained — INFRA-097');
  });

  it('rejects same-head old-base, wrong-tool, and wrong-category analysis identities', () => {
    const gate = jobBlock(REVIEW_GATE, 'review-gate', 'disarm-auto-merge');
    expect(gate).toContain('CURRENT_MERGE_SHA');
    expect(gate).toMatch(/\.tool\.name == \\?"CodeQL\\?"/);
    expect(gate).toContain('/language:javascript-typescript');
    expect(gate).toMatch(/commit_sha\s*==[\s\\"]*\$\{CURRENT_MERGE_SHA\}/);
  });

  it('keeps write permissions separated by job capability', () => {
    const classify = jobBlock(REVIEW_GATE, 'classify', 'analyze');
    const analyze = jobBlock(REVIEW_GATE, 'analyze', 'review-gate');
    const gate = jobBlock(REVIEW_GATE, 'review-gate', 'disarm-auto-merge');
    const disarm = jobBlock(REVIEW_GATE, 'disarm-auto-merge');

    expect(permissionsBlock(classify)).toMatch(/contents:\s*read/);
    expect(permissionsBlock(classify)).not.toMatch(
      /security-events:\s*write|pull-requests:\s*write/,
    );
    expect(permissionsBlock(analyze)).toMatch(/contents:\s*read[\s\S]*security-events:\s*write/);
    expect(permissionsBlock(analyze)).not.toMatch(/pull-requests:\s*write|contents:\s*write/);
    expect(permissionsBlock(gate)).toMatch(/security-events:\s*read/);
    expect(permissionsBlock(gate)).toMatch(/pull-requests:\s*write/);
    expect(permissionsBlock(gate)).not.toMatch(/security-events:\s*write|contents:\s*write/);
    expect(permissionsBlock(disarm)).toMatch(/contents:\s*write/);
    expect(disarm).not.toContain('actions/checkout');
  });

  it('uses the classifier as the only docs-only owner and skips CodeQL only for labels or explicit false', () => {
    expect(REVIEW_GATE).not.toMatch(/paths-ignore:/);
    expect(CODEQL).not.toMatch(/paths-ignore:/);
    expect(
      REVIEW_GATE.match(/^\s*node scripts\/harness\/classify-changed-paths\.mjs/gm),
    ).toHaveLength(1);
    const analyze = jobBlock(REVIEW_GATE, 'analyze', 'review-gate');
    expect(analyze).toMatch(/labeled[\s\S]*unlabeled/);
    expect(analyze).toMatch(/needs\.classify\.outputs\.code\s*==\s*'true'/);
  });

  it('keeps standalone CodeQL push-only and removes recovery authority', () => {
    expect(CODEQL).toMatch(/push:\s*\n\s*branches:\s*\[main, develop\]/);
    expect(CODEQL).not.toMatch(/pull_request:/);
    expect(CODEQL).not.toContain('recover-review-gate');
    expect(CODEQL).not.toContain('actions: write');
    expect(CODEQL).not.toContain('gh run rerun');
  });
});
