import { describe, expect, it } from 'vitest';
import { evaluatorIsolationFindings } from '../scan-gate-evaluator-isolation.mjs';

describe('gate-evaluator-isolation', () => {
  it('rejects evaluator and evidence changes in one diff', () => {
    expect(
      evaluatorIsolationFindings([
        'scripts/harness/gate.mjs',
        '.agents/spec-docs/active/RULE-025.md',
      ]),
    ).toHaveLength(1);
  });

  it('allows evidence changes without evaluator changes', () => {
    expect(evaluatorIsolationFindings(['.agents/spec-docs/active/RULE-025.md'])).toEqual([]);
  });
});
