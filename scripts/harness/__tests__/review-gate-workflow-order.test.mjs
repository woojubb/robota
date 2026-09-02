import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

function runJq(program, input, args = []) {
  return execFileSync('jq', ['-cer', ...args, program], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  }).trim();
}

describe('review-gate defers CodeQL outside the required PR path', () => {
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
    expect(analyze).toContain('if: ${{ false }}');
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
      /uses:\s*actions\/checkout@v7[\s\S]*ref:\s*\$\{\{ github\.event\.pull_request\.base\.sha \}\}/,
    );
    expect(analyze).not.toContain('github.event.pull_request.base.sha');
    expect(REVIEW_GATE).toContain('Contained — INFRA-097');
  });

  it('rejects same-head old-base, wrong-tool, and wrong-category analysis identities', () => {
    const gate = jobBlock(REVIEW_GATE, 'review-gate', 'disarm-auto-merge');
    expect(gate).toContain('CURRENT_MERGE_SHA');
    expect(gate).toContain('github.sha');
    expect(gate).toContain('.parents[0].sha, .parents[1].sha, .tree.sha');
    expect(gate).toContain('.tool.name == "CodeQL"');
    expect(gate).toContain('.category == "/language:javascript-typescript"');
    expect(gate).toContain('[ "${candidate_identity}" = "${current_identity}" ]');
    expect(gate).not.toMatch(/commit_sha\s*==[\s\\"]*\$\{CURRENT_MERGE_SHA\}/);
  });

  it('executes the checked-in jq identity programs against regenerated and stale merges', () => {
    const gate = jobBlock(REVIEW_GATE, 'review-gate', 'disarm-auto-merge');
    const inventoryProgram = gate.match(
      /'(?<program>add \| map\(select\(\.tool\.name == "CodeQL"[^']+\)\))'/,
    )?.groups?.program;
    const eventProgram = gate.match(
      /'(?<program>\[\.\[\] \| select\(\.commit_sha == \$sha\)\]\[0\]\.commit_sha \/\/ empty)'/,
    )?.groups?.program;
    const identityProgram = gate.match(
      /'(?<program>select\(\(\.parents \| length\) == 2\) \| \[\.parents\[0\]\.sha, \.parents\[1\]\.sha, \.tree\.sha\] \| @tsv)'/,
    )?.groups?.program;
    expect(inventoryProgram).toBeTruthy();
    expect(eventProgram).toBeTruthy();
    expect(identityProgram).toBeTruthy();

    const analyses = runJq(inventoryProgram, [
      [
        {
          commit_sha: 'event',
          tool: { name: 'CodeQL' },
          category: '/language:javascript-typescript',
        },
        {
          commit_sha: 'wrong-tool',
          tool: { name: 'Other' },
          category: '/language:javascript-typescript',
        },
        { commit_sha: 'wrong-category', tool: { name: 'CodeQL' }, category: '/other' },
      ],
    ]);
    expect(runJq(eventProgram, JSON.parse(analyses), ['--arg', 'sha', 'event'])).toBe('event');

    const current = { parents: [{ sha: 'base' }, { sha: 'head' }], tree: { sha: 'tree' } };
    const regenerated = { parents: [{ sha: 'base' }, { sha: 'head' }], tree: { sha: 'tree' } };
    const oldBase = { parents: [{ sha: 'old-base' }, { sha: 'head' }], tree: { sha: 'tree' } };
    expect(runJq(identityProgram, regenerated)).toBe(runJq(identityProgram, current));
    expect(runJq(identityProgram, oldBase)).not.toBe(runJq(identityProgram, current));
    expect(() =>
      runJq(identityProgram, { parents: [{ sha: 'base' }], tree: { sha: 'tree' } }),
    ).toThrow();
  });

  it('collects alerts only from the selected immutable analysis identity', () => {
    const gate = jobBlock(REVIEW_GATE, 'review-gate', 'disarm-auto-merge');
    expect(gate).toContain('ANALYSIS_RESULTS_COUNT');
    expect(gate).toContain('code-scanning/alerts?state=open&ref=refs/pull/${PR_NUMBER}/merge');
    expect(gate).toContain('code-scanning/alerts?state=dismissed&ref=refs/pull/${PR_NUMBER}/merge');
    expect(gate).toContain('.most_recent_instance.commit_sha == $sha');
    expect(gate).toContain('[ "${current_result_count}" != "${ANALYSIS_RESULTS_COUNT}" ]');

    const selectedEquivalent = {
      number: 1,
      most_recent_instance: { commit_sha: 'selected-equivalent' },
    };
    const newerDifferentMerge = {
      number: 2,
      most_recent_instance: { commit_sha: 'newer-different-merge' },
    };
    const instanceProgram =
      'type == "array" and all(.[]; .most_recent_instance.commit_sha == $sha)';
    expect(
      runJq(instanceProgram, [selectedEquivalent], ['--arg', 'sha', 'selected-equivalent']),
    ).toBe('true');
    expect(() =>
      runJq(
        instanceProgram,
        [selectedEquivalent, newerDifferentMerge],
        ['--arg', 'sha', 'selected-equivalent'],
      ),
    ).toThrow();
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

  it('uses the classifier as the only docs-only owner and keeps PR CodeQL disabled', () => {
    expect(REVIEW_GATE).not.toMatch(/paths-ignore:/);
    expect(CODEQL).not.toMatch(/paths-ignore:/);
    expect(
      REVIEW_GATE.match(/^\s*node scripts\/harness\/classify-changed-paths\.mjs/gm),
    ).toHaveLength(1);
    const analyze = jobBlock(REVIEW_GATE, 'analyze', 'review-gate');
    expect(analyze).toContain('if: ${{ false }}');
    expect(analyze).not.toMatch(/needs\.classify\.outputs\.code\s*==\s*'true'/);
  });

  it('keeps standalone CodeQL push-only and removes recovery authority', () => {
    expect(CODEQL).toMatch(/push:\s*\n\s*branches:\s*\[main, develop\]/);
    expect(CODEQL).not.toMatch(/pull_request:/);
    expect(CODEQL).not.toContain('recover-review-gate');
    expect(CODEQL).not.toContain('actions: write');
    expect(CODEQL).not.toContain('gh run rerun');
  });
});
