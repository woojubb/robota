import { describe, expect, it } from 'vitest';

import { classifyFiles } from '../classify-changed-paths.mjs';

const PROC_017_PATHS = [
  'scripts/harness/conversion-evidence.mjs',
  'scripts/harness/__tests__/conversion-evidence.test.mjs',
  'scripts/harness/scan-user-execution-plan-order.mjs',
  'scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs',
  'scripts/harness/__tests__/proc-017-affected-paths.test.mjs',
  'scripts/harness/record-pr-lifecycle-measurement.mjs',
  'scripts/harness/compare-pr-lifecycle-measurements.mjs',
  '.agents/rules/backlog-execution.md',
  '.agents/skills/issue-to-backlog/SKILL.md',
  '.agents/skills/backlog-execution-orchestrator/SKILL.md',
  '.agents/skills/user-request-gate/SKILL.md',
];

describe('PROC-017 affected path selection', () => {
  it('classifies PROC-017 affected paths', () => {
    expect(PROC_017_PATHS).toHaveLength(11);
    expect(classifyFiles(PROC_017_PATHS)).toMatchObject({
      code: true,
      product: false,
      harness: true,
    });
  });
});
