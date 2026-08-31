import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseUserExecutionPlanContract,
  validateSpecUserExecutionPlan,
  validateTaskUserExecutionPlan,
} from '../user-execution-plan-contract.mjs';

const RULE = readFileSync(
  path.resolve(import.meta.dirname, '../../../.agents/rules/backlog-execution.md'),
  'utf8',
);

describe('user-execution PLAN contract module', () => {
  it('parses the owner declaration and accepts a substantive structured Task reason', () => {
    const parsed = parseUserExecutionPlanContract(RULE);
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    expect(
      validateTaskUserExecutionPlan(
        parsed.contract,
        '## User Execution Test Scenarios\n\n**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`\n\n**Reason:** This internal repository checkpoint rule exposes no runnable Robota product behavior or observable user action.',
      ),
    ).toMatchObject({ ok: true, outcome: 'not-applicable', count: 0 });
  });

  it('requires the reason after the exact outcome signal and stops before ordered lists', () => {
    const parsed = parseUserExecutionPlanContract(RULE);
    const substantive =
      'This internal repository checkpoint rule exposes no runnable Robota product behavior or observable user action.';

    expect(
      validateTaskUserExecutionPlan(
        parsed.contract,
        `## User Execution Test Scenarios\n\n**Reason:** ${substantive}\n\n**Author verdict:** \`SCENARIO DRAFTED: not-applicable | 0\``,
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateSpecUserExecutionPlan(
        parsed.contract,
        `## User Execution Test Scenarios\n\n**Reason:** ${substantive}\n\nNot applicable.`,
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateSpecUserExecutionPlan(
        parsed.contract,
        '## User Execution Test Scenarios\n\nNot applicable.\n\n**Reason:** too short\n1. This ordered list must not inflate the reason with enough unrelated words and characters to pass.',
      ),
    ).toMatchObject({ ok: false });
  });

  it('rejects placeholders and accepts only a complete applicable scenario contract', () => {
    const parsed = parseUserExecutionPlanContract(RULE);
    expect(
      validateSpecUserExecutionPlan(
        parsed.contract,
        '## User Execution Test Scenarios\n\nTODO: write the scenario later.',
      ),
    ).toMatchObject({ ok: false });

    const scenario = [
      '## User Execution Test Scenarios',
      '',
      '### Scenario 1: inspect the version',
      '',
      '- **executability:** agent-executable',
      '- **product surface:** robota-cli',
      '- **surface rationale:** shipped-entrypoint=robota',
      '- **prerequisites:** the built Robota CLI is available',
      '- **command:** `robota --version`',
      '- **observable type:** product-output',
      '- **observable rationale:** source=product-process',
      '- **expected observable:** exit=0; output-contains=robota',
      '- **cleanup:** none',
      '- **evidence:** pending implementation',
    ].join('\n');
    expect(validateSpecUserExecutionPlan(parsed.contract, scenario)).toMatchObject({
      ok: true,
      outcome: 'applicable',
      count: 1,
    });
  });
});
