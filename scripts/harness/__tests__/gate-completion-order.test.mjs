import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function section(markdown, heading, nextHeadingLevel = heading.match(/^#+/)?.[0].length ?? 3) {
  const start = markdown.indexOf(heading);
  if (start === -1) throw new Error(`missing heading: ${heading}`);
  const rest = markdown.slice(start + heading.length);
  const next = rest.search(new RegExp(`^#{1,${nextHeadingLevel}}\\s`, 'm'));
  return next === -1 ? rest : rest.slice(0, next);
}

describe('GATE-COMPLETE transition ownership', () => {
  it('judges an active completion-ready task before Phase 5 archives the task atomically', () => {
    const catalogue = section(read('.agents/specs/gate-catalogue.md'), '### GATE-COMPLETE');
    const workflow = read('.agents/rules/spec-workflow.md');
    const execution = section(read('.agents/rules/backlog-execution.md'), '## Completion Steps', 2);
    const orchestrator = section(
      read('.agents/skills/backlog-execution-orchestrator/SKILL.md'),
      '### Phase 5 — Completion',
    );

    expect(catalogue).toContain('active task path');
    expect(catalogue).toContain('completion-ready');
    expect(catalogue).not.toContain('Tasks file archived to');
    expect(catalogue).not.toContain('Tasks section updated to reflect archived path');

    expect(workflow).toContain('| `verifying`             | `.agents/spec-docs/active/`');
    expect(workflow).toContain('| `done`                  | `.agents/spec-docs/done/`');
    expect(execution).toContain('set `status: done`');
    expect(execution).toContain('Move the file');
    expect(execution).toContain('SAME commit');
    expect(orchestrator).toContain('status change and the file move are **one commit**');
  });

  it('keeps planned Test Plan content immutable and actual results in the Evidence Log only', () => {
    const catalogue = section(read('.agents/specs/gate-catalogue.md'), '### GATE-COMPLETE');
    const recommendation = section(
      read('.agents/rules/backlog-execution.md'),
      '## Recommendation Gate',
      2,
    );

    expect(catalogue).toMatch(/The planned\s+Test Plan is not rewritten with completion results/);
    expect(catalogue).not.toContain('`## Test Plan` updated with test references');
    expect(catalogue).toMatch(
      /Evidence entry per TC-N[\s\S]*actual test path\/name or skip reason/,
    );
    expect(recommendation).toContain(
      'actual test paths, commands, outputs, results, exit codes, and skip reasons belong only',
    );
  });
});

describe('pre-commit planning gate order', () => {
  it('formats the proposed index before both ordering guards and shares endorsement classification', () => {
    const hook = read('.husky/pre-commit');
    const planOrder = read('scripts/harness/scan-user-execution-plan-order.mjs');
    const lintAt = hook.indexOf('pnpm lint:fix:staged');
    const planAt = hook.indexOf('scan-user-execution-plan-order.mjs --staged');
    const endorsementAt = hook.indexOf('scan-recommendation-endorsement.mjs --staged');

    expect(lintAt).toBeGreaterThan(-1);
    expect(planAt).toBeGreaterThan(lintAt);
    expect(endorsementAt).toBeGreaterThan(planAt);
    expect(planOrder).toContain('isCommittedRecommendationCheckpoint');
    expect(planOrder).toContain('isStagedRecommendationCheckpoint');
  });
});
