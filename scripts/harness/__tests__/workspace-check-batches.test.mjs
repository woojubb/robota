import { describe, expect, it } from 'vitest';

import {
  createWorkspaceCheckBatches,
  executeWorkspaceCheckBatches,
} from '../workspace-check-batches.mjs';

const scopes = [
  {
    relativeDir: 'packages/a',
    workspaceName: '@x/a',
    scripts: { test: 'v', lint: 'e', typecheck: 't' },
    hasTsconfig: true,
  },
  {
    relativeDir: 'packages/b',
    workspaceName: '@x/b',
    scripts: { test: 'v', lint: 'e', typecheck: 't' },
    hasTsconfig: true,
  },
];
const planScopes = scopes.map((scope) => ({
  scope: scope.relativeDir,
  checks: ['test', 'lint', 'typecheck'],
}));

describe('bounded full-workspace check batches', () => {
  it('uses one bounded pnpm launch per check instead of one launch per scope/check', () => {
    const batches = createWorkspaceCheckBatches({ planScopes, scopes, concurrency: 4 });
    expect(batches).toHaveLength(3);
    expect(batches).toHaveLength(3);
    expect(scopes.length * 3).toBeGreaterThan(batches.length);
    for (const batch of batches) {
      expect(batch.args).toContain('--workspace-concurrency=4');
      expect(batch.args).toContain('--no-bail');
      expect(batch.args).toContain('--aggregate-output');
      expect(batch.args).toContain('--fail-if-no-match');
      expect(batch.scopeNames).toEqual(['packages/a', 'packages/b']);
    }
  });

  it('runs every batch and aggregates failures instead of stopping at the first one', () => {
    const batches = createWorkspaceCheckBatches({ planScopes, scopes, concurrency: 4 });
    const seen = [];
    const result = executeWorkspaceCheckBatches(batches, (batch) => {
      seen.push(batch.check);
      return { status: batch.check === 'lint' ? 1 : 0 };
    });

    expect(seen).toEqual(['test', 'lint', 'typecheck']);
    expect(result.failures.map((failure) => failure.check)).toEqual(['lint']);
    expect(result.evidence).toHaveLength(6);
  });

  it('fails closed when a batch runner returns no result evidence', () => {
    const [batch] = createWorkspaceCheckBatches({ planScopes, scopes, concurrency: 4 });
    expect(() => executeWorkspaceCheckBatches([batch], () => undefined)).toThrow(
      'Missing batch result evidence for test',
    );
  });
});
