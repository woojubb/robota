import { describe, expect, it } from 'vitest';

import { classifyRepositoryChecks } from '../repository-check-classification.mjs';

describe('repository-check-classification', () => {
  it('selects harness tests and consistency for a harness-only root script change', () => {
    expect(
      classifyRepositoryChecks(['package.json'], {
        changedScriptKeys: ['harness:work-run'],
      }),
    ).toEqual(['harness-tests', 'harness-consistency']);
  });

  it('deduplicates checks while preserving the first-seen order', () => {
    expect(
      classifyRepositoryChecks([
        'scripts/harness/work-run.mjs',
        '.github/workflows/ci.yml',
        '.agents/tasks/OBSERVABILITY-002.md',
      ]),
    ).toEqual(['harness-tests', 'harness-consistency', 'task-plan-scan']);
  });
});
