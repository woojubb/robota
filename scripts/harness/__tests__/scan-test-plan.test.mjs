import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { ADVISORY_MARKER } from '../run-all-scans.mjs';
import { collectTestPlanFindings, hasTestPlanSection, main } from '../scan-test-plan.mjs';

describe('hasTestPlanSection', () => {
  it('returns true for ## Test Plan with enough content', () => {
    const doc = `# My Plan\n\n## Test Plan\n\nUnit tests for the parser module covering edge cases and error paths. Run with pnpm test.\n`;
    expect(hasTestPlanSection(doc)).toBe(true);
  });

  it('returns true for ## Testing heading', () => {
    const doc = `# Spec\n\n## Testing\n\nIntegration tests verify the full pipeline from input to output. Mock providers used for isolation.\n`;
    expect(hasTestPlanSection(doc)).toBe(true);
  });

  it('returns true for ## 테스트 heading (Korean)', () => {
    const doc = `# 설계\n\n## 테스트\n\n단위 테스트로 파서 모듈의 엣지 케이스와 에러 경로를 검증합니다. pnpm test로 실행합니다.\n`;
    expect(hasTestPlanSection(doc)).toBe(true);
  });

  it('returns true for ## 검증 heading (Korean)', () => {
    const doc = `# 태스크\n\n## 검증\n\n통합 테스트를 통해 전체 파이프라인이 입력부터 출력까지 정상 동작하는지 확인합니다. 모의 프로바이더를 사용합니다.\n`;
    expect(hasTestPlanSection(doc)).toBe(true);
  });

  it('returns true for ### Test Strategy (h3)', () => {
    const doc = `# Plan\n\n### Test Strategy\n\nContract tests between provider and consumer packages. Vitest with mock providers for unit tests.\n`;
    expect(hasTestPlanSection(doc)).toBe(true);
  });

  it('returns false when no test section exists', () => {
    const doc = `# My Plan\n\n## Architecture\n\nSome architecture details here.\n\n## Implementation\n\nSteps to implement.\n`;
    expect(hasTestPlanSection(doc)).toBe(false);
  });

  it('returns false when test section has insufficient content (<50 chars)', () => {
    const doc = `# Plan\n\n## Test Plan\n\nTBD\n\n## Next Section\n`;
    expect(hasTestPlanSection(doc)).toBe(false);
  });

  it('returns false for empty test section', () => {
    const doc = `# Plan\n\n## Testing\n\n## Architecture\n\nDetails.\n`;
    expect(hasTestPlanSection(doc)).toBe(false);
  });

  it('returns true when content is exactly 50 chars', () => {
    const filler = 'a'.repeat(50);
    const doc = `# Plan\n\n## Test Plan\n\n${filler}\n`;
    expect(hasTestPlanSection(doc)).toBe(true);
  });

  it('returns false when content is 49 chars', () => {
    const filler = 'a'.repeat(49);
    const doc = `# Plan\n\n## Test Plan\n\n${filler}\n`;
    expect(hasTestPlanSection(doc)).toBe(false);
  });
});

/**
 * HARNESS-052 — WHICH tree this gate covers, and what it refuses to cover.
 *
 * It gated `docs/superpowers/**` (which another guard classifies as dated historical artifacts)
 * while the live pipeline `.agents/spec-docs/**` went unscanned. The states are now chosen: gated
 * from `backlog/` onward (post-GATE-WRITE, where a verification test plan is required), never in
 * `draft/` (pre-GATE-WRITE, incomplete by design) and never in `done/` or `rejected/` (immutable
 * history). Sweeping all 242 spec documents would have fired on 6 archived records and 1 legitimate
 * draft — a gate firing on things nobody can act on is one that gets suppressed.
 */
describe('collectTestPlanFindings — the gated tree', () => {
  async function specDocsFixture(files) {
    const root = makeTemp('robota-test-plan-');
    for (const state of ['draft', 'backlog', 'todo', 'active', 'done', 'rejected']) {
      mkdirSync(path.join(root, '.agents/spec-docs', state), { recursive: true });
    }
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(root, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf8');
    }
    return root;
  }

  const NO_PLAN = '---\nstatus: approved\n---\n\n# X\n\n## Problem\n\nSomething is broken.\n';

  it('flags a live-pipeline spec document with no test plan', async () => {
    const root = await specDocsFixture({ '.agents/spec-docs/todo/CLI-999-thing.md': NO_PLAN });
    const { findings, examined } = await collectTestPlanFindings(root);
    expect(examined).toBe(1);
    expect(findings.map((f) => f.file)).toEqual([
      path.join('.agents/spec-docs/todo', 'CLI-999-thing.md'),
    ]);
  });

  it('does not gate draft/, done/ or rejected/', async () => {
    const root = await specDocsFixture({
      '.agents/spec-docs/draft/CLI-998-thing.md': NO_PLAN,
      '.agents/spec-docs/done/CLI-997-thing.md': NO_PLAN,
      '.agents/spec-docs/rejected/CLI-996-thing.md': NO_PLAN,
    });
    const { findings, examined } = await collectTestPlanFindings(root);
    expect(findings).toEqual([]);
    expect(examined).toBe(0);
  });

  it('throws rather than passing when the spec-doc pipeline is absent', async () => {
    const bare = makeTemp('robota-test-plan-bare-');
    await expect(collectTestPlanFindings(bare)).rejects.toThrow(/spec-docs/);
  });
});

/**
 * HARNESS-063 — the count, split by half.
 *
 * Measured on this repository 2026-08-01: `26 document(s) checked`, of which 26 came from
 * `docs/superpowers/` (history) and 0 from the live pipeline. A single number let a frozen archive
 * stand in for the tree a reader assumes was scanned.
 */
describe('main — the examined count is reported per half', () => {
  const WITH_PLAN = [
    '# X',
    '',
    '## Test Plan',
    '',
    'Unit tests cover the parser edge cases and the error paths; run them with pnpm test.',
    '',
  ].join('\n');

  async function fixture(files) {
    const root = makeTemp('robota-test-plan-halves-');
    for (const state of ['draft', 'backlog', 'todo', 'active', 'done', 'rejected']) {
      mkdirSync(path.join(root, '.agents/spec-docs', state), { recursive: true });
    }
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(root, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf8');
    }
    return root;
  }

  async function run(root) {
    const lines = [];
    const code = await main(root, (line) => lines.push(line));
    return { code, output: lines.join('') };
  }

  it('counts a known population into the live and archived halves', async () => {
    const root = await fixture({
      '.agents/spec-docs/todo/CLI-001.md': WITH_PLAN,
      '.agents/spec-docs/active/CLI-002.md': WITH_PLAN,
      'docs/superpowers/plans/old-plan.md': WITH_PLAN,
    });

    const { examined, examinedLive, examinedArchive } = await collectTestPlanFindings(root);
    expect({ examined, examinedLive, examinedArchive }).toEqual({
      examined: 3,
      examinedLive: 2,
      examinedArchive: 1,
    });

    const { code, output } = await run(root);
    expect(code).toBe(0);
    expect(output).toContain('harness test-plan scan passed (3 document(s) checked: 2 live');
    expect(output).toContain('1 archived (docs/superpowers/plans, docs/superpowers/specs)');
    expect(output).not.toContain(ADVISORY_MARKER);
  });

  it('raises an advisory when the live half is empty and only the archive supplies the count', async () => {
    // This is the shipped state of the repository, in a fixture: a green line reading "26 checked"
    // where the live pipeline contributed nothing.
    const root = await fixture({
      'docs/superpowers/plans/old-plan.md': WITH_PLAN,
      'docs/superpowers/specs/old-spec.md': WITH_PLAN,
    });

    const { code, output } = await run(root);
    expect(code).toBe(0);
    expect(output).toContain('(2 document(s) checked: 0 live');
    expect(output).toContain(`${ADVISORY_MARKER} test-plan examined 0 live planning documents`);
  });

  it('reports 0 for an empty corpus instead of an unqualified pass', async () => {
    const root = await fixture({});
    const { code, output } = await run(root);
    expect(code).toBe(0);
    expect(output).toContain('(0 document(s) checked: 0 live');
    expect(output).toContain('0 archived');
    expect(output).toContain(ADVISORY_MARKER);
  });

  it('still fails on a live document with no test plan, and names the counts', async () => {
    const root = await fixture({
      '.agents/spec-docs/todo/CLI-003.md': '# X\n\n## Problem\n\nBroken.\n',
    });
    const { code, output } = await run(root);
    expect(code).toBe(1);
    expect(output).toContain('harness test-plan scan failed (1 document(s) checked: 1 live');
    expect(output).toContain('CLI-003.md');
  });
});
