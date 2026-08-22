import { describe, expect, it } from 'vitest';

import {
  ARCHITECTURE_REFRESH_ARRAY_FIELDS,
  architectureExpectationError,
  normalizeArchitectureRefreshMetadata,
} from '../architecture-refresh-record.mjs';

describe('architecture refresh record contract', () => {
  it('projects legacy metadata into one complete namespaced shape', () => {
    const entry = {
      signalExpectations: [{ phase: 'verify', agent: 'finding-verifier', subject: 'F-1' }],
      verificationPassThroughIds: ['F-2'],
      nestedRunId: 'nested-r1',
    };

    const metadata = normalizeArchitectureRefreshMetadata(entry);

    expect(Object.keys(metadata).sort()).toEqual([...ARCHITECTURE_REFRESH_ARRAY_FIELDS].sort());
    expect(metadata.signalExpectations).toEqual([
      { round: 1, phase: 'verify', agent: 'finding-verifier', subject: 'F-1' },
    ]);
    expect(metadata.verificationPassThroughIds).toEqual([{ round: 1, id: 'F-2' }]);
    expect(metadata.nestedRuns).toEqual([{ round: 1, runId: 'nested-r1' }]);
    expect(entry).not.toHaveProperty('signalExpectations');
    expect(entry).not.toHaveProperty('nestedRunId');
  });

  it('owns the closed expectation vocabulary for both architecture loops', () => {
    expect(
      architectureExpectationError('architecture-refresh', {
        phase: 'conformance',
        agent: 'architecture-conformance-auditor',
        subject: 'scope',
        token: 'ACTIONABLE FINDINGS',
      }),
    ).toBeNull();
    expect(
      architectureExpectationError('architecture-audit-fanout', {
        phase: 'audit',
        agent: 'architecture-runtime-auditor',
        subject: 'runtime:1/1',
        token: 'AUDIT-DIM-COMPLETE',
      }),
    ).toBeNull();
    expect(
      architectureExpectationError('architecture-refresh', {
        phase: 'audit',
        agent: 'architecture-runtime-auditor',
        subject: 'runtime:1/1',
        token: 'AUDIT-DIM-COMPLETE',
      }),
    ).toMatch(/outside/);
  });
});
