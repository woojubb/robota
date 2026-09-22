import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

const dimensions = {
  structure: read('.claude/agents/architecture-structure-auditor.md'),
  design: read('.claude/agents/architecture-design-auditor.md'),
  runtime: read('.claude/agents/architecture-runtime-auditor.md'),
  gate: read('.claude/agents/architecture-gate-auditor.md'),
};

describe('architecture audit dimensional contracts', () => {
  it('preserves all eleven universal criteria under explicit owners', () => {
    expect(dimensions.structure).toMatch(/responsibility placement/i);
    expect(dimensions.design).toMatch(/cohesion and coupling/i);
    expect(dimensions.structure).toMatch(/dependency direction and acyclicity/i);
    expect(dimensions.design).toMatch(/single ownership of facts, types, and contracts/i);
    expect(dimensions.design).toMatch(/encapsulation and information hiding/i);
    expect(dimensions.design).toMatch(/contract quality and evolution safety/i);
    expect(dimensions.runtime).toMatch(/error-path completeness and detectability/i);
    expect(dimensions.design).toMatch(/extension seams/i);
    expect(dimensions.gate).toMatch(/test-quality risk and verification honesty/i);
    expect(dimensions.structure).toMatch(/structural simplicity and least surprise/i);
    expect(dimensions.structure).toMatch(/structural placement of a new surface/i);
  });

  it('requires one exact dimensional terminal signal with shared severity and coverage fields', () => {
    for (const [dimension, definition] of Object.entries(dimensions)) {
      expect(definition).toContain('signal: AUDIT-DIM-COMPLETE');
      expect(definition).toContain(
        `AUDIT-DIM-COMPLETE: dim=${dimension} shard=<k>/<n> blocker=<n> high=<n> medium=<n> low=<n> coverage=<covered>/<total> uncovered=<cells|none>`,
      );
    }
  });
});

describe('issue #2826 architecture routing', () => {
  const fanout = read('.agents/skills/architecture-audit-fanout/SKILL.md');
  const refresh = read('.agents/skills/architecture-refresh/SKILL.md');
  const map = read('.agents/specs/orchestration-map.md');

  it('retries uncovered cells without a committed loop ledger', () => {
    expect(fanout).toMatch(/loop: over=uncovered-cells; escape=no-progress; bound=3 rounds/);
    expect(fanout).toMatch(/Retry only uncovered cells/i);
    expect(fanout).toMatch(/Do not write a per-skill ledger/i);
    expect(fanout).not.toContain('loop-run.mjs');
  });

  it('uses specialist classification only when it contributes a distinct decision', () => {
    expect(refresh).toMatch(/only for a genuinely foundational or ambiguous finding/i);
    expect(refresh).toMatch(/not mandatory links in the\s+normal chain/i);
    expect(refresh).not.toContain('loop-run.mjs');
  });

  it('registers the normal route and keeps all specialists reachable without making a chain', () => {
    expect(map).toContain('There is no required proposal-reviewer');
    expect(map).toContain('conflict-free target advance does not restart');
    for (const agent of Object.keys(dimensions).map((name) => `architecture-${name}-auditor`)) {
      expect(map).toContain(`\`${agent}\``);
    }
    expect(map).toContain('`finding-depth-triager`');
    expect(map).toContain('optional helpers, not universal dispatch requirements');
  });
});
