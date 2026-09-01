import { describe, expect, it } from 'vitest';

import {
  scenarioEntries,
  validateApplicableScenarioSection,
} from '../user-execution-scenario-contract.mjs';

const SCENARIO = [
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

describe('user-execution applicable scenario contract', () => {
  it('parses numbered scenarios and rejects prose placeholders', () => {
    expect(scenarioEntries(SCENARIO)).toHaveLength(1);
    expect(validateApplicableScenarioSection(SCENARIO)).toMatchObject({ ok: true });
    expect(validateApplicableScenarioSection('TODO: add a scenario')).toMatchObject({ ok: false });
  });
});
