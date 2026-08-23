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
      expect(definition).toMatch(/exactly one terminal line/i);
      expect(definition).toMatch(/Only\s+blocker\/high\/medium are material/i);
    }
  });
});

describe('nested and outer architecture orchestration', () => {
  const fanout = read('.agents/skills/architecture-audit-fanout/SKILL.md');
  const refresh = read('.agents/skills/architecture-refresh/SKILL.md');
  const map = read('.agents/specs/orchestration-map.md');
  const commonMistakes = read('.agents/rules/common-mistakes.md');
  const enforcement = read('.agents/rules/enforcement-architecture.md');
  const skillIndex = read('.agents/skills/index.md');

  it('bounds coverage retries and keeps unrelated judgements outside the fanout', () => {
    expect(fanout).toMatch(/loop: over=finding-set; escape=no-progress; bound=3 rounds/);
    expect(fanout).toMatch(/redispatch only the exact prior uncovered-cell set/i);
    expect(fanout).toMatch(/never merges, deduplicates, promotes, rejects, verifies,/i);
    expect(fanout).toMatch(/not a fanout dimension/i);
  });

  it('routes every outer guardian and every terminal outcome', () => {
    for (const agent of [
      'architecture-conformance-auditor',
      'architecture-audit-synthesizer',
      'finding-verifier',
      'finding-depth-triager',
      'finding-reconciler',
      'architecture-fixer',
      'architecture-implementer',
    ]) {
      expect(refresh).toContain(agent);
    }
    for (const outcome of ['CONFIRMED', 'REFUTED', 'UNPROVABLE']) {
      expect(refresh).toContain(outcome);
    }
    for (const outcome of ['LOCAL', 'INVALID', 'UNDETERMINED', 'FOUNDATIONAL']) {
      expect(refresh).toContain(outcome);
    }
    for (const outcome of ['NEW', 'KNOWN', 'EXTENDS', 'UNSURE']) {
      expect(refresh).toContain(outcome);
    }
    expect(refresh).toMatch(/Low findings remain .* do not keep the loop alive/i);
  });

  it('registers every nested/outer direct edge and both re-audit loop-backs in the map', () => {
    expect(map).toMatch(
      /\| \*\*Architecture audit fanout\*\* \(nested\).*`architecture-audit-fanout`/,
    );
    expect(map).toMatch(/\| \*\*Architecture refresh\*\*.*nested `architecture-audit-fanout`/);
    for (const edge of [
      'AR[architecture-refresh<br/>outer orchestrator] --> AAF[architecture-audit-fanout',
      'AAF --> ASAUD[architecture-structure-auditor',
      'AAF --> ADAUD[architecture-design-auditor',
      'AAF --> ARAUD[architecture-runtime-auditor',
      'AAF --> AGAUD[architecture-gate-auditor',
      'AR --> ACA[architecture-conformance-auditor',
      'AR --> AAS[architecture-audit-synthesizer',
      'AR --> FV[finding-verifier',
      'AR --> ARD[finding-depth-triager',
      'AR --> FR[finding-reconciler',
      'AR --> AF[architecture-fixer',
      'AR --> AI[architecture-implementer',
      'AF -. corrected / contained .-> AR',
      'AI -. corrected / contained .-> AR',
    ]) {
      expect(map).toContain(edge);
    }
  });

  it('keeps the entry-point guidance, index, and mechanical floors wired', () => {
    for (const skill of ['architecture-refresh', 'architecture-audit-fanout']) {
      expect(skillIndex).toContain(`[${skill}](${skill}/SKILL.md)`);
    }
    for (const agent of [
      'architecture-structure-auditor',
      'architecture-design-auditor',
      'architecture-runtime-auditor',
      'architecture-gate-auditor',
      'architecture-audit-synthesizer',
      'finding-verifier',
      'finding-reconciler',
    ]) {
      expect(skillIndex).toContain(`\`${agent}\``);
    }
    expect(commonMistakes).toMatch(
      /architecture-refresh.*architecture-audit-fanout.*architecture-conformance-auditor/i,
    );
    expect(enforcement).toContain('architecture-refresh-signals');
    expect(enforcement).toContain('retired-agent-references');
  });
});
