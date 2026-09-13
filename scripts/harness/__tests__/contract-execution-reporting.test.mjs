import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ registryError: undefined }));

vi.mock('node:child_process', () => ({
  spawnSync: () => ({ status: 0, stdout: Buffer.alloc(0) }),
}));
vi.mock('../affected-contract-tests.mjs', () => ({
  resolveChangedContractInputs: () => ({ ok: true, files: ['changed.mjs'] }),
  createAffectedContractPlan: () => ({
    mode: 'affected',
    reason: 'fixture',
    selected: ['cached', 'failed', 'isolated'],
    shards: [['cached', 'failed']],
    isolated: ['isolated'],
    selectedByOwner: [{ owner: 'harness', tests: ['cached', 'failed', 'isolated'] }],
  }),
}));
vi.mock('../contract-test-inputs.mjs', () => ({
  createContractTestRegistry: () => {
    if (state.registryError) throw state.registryError;
    return [];
  },
}));
vi.mock('../contract-test-cache.mjs', () => ({
  inspectContractTestCache: () => ({ hits: ['cached'], misses: ['failed', 'isolated'] }),
  recordSuccessfulContractShard: () => 0,
}));
vi.mock('../harness-vitest-process.mjs', () => ({
  vitestInvocationAsync: async () => ({ status: 1, signal: null }),
  vitestInvocation: () => {
    throw new Error('isolated shard must not start after failure');
  },
}));

import { runAffectedContractTier } from '../harness-contract-execution.mjs';

it('returns truthful coverage from the actual tier orchestration path', async () => {
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const errors = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const previousExitCode = process.exitCode;
  try {
    const result = await runAffectedContractTier([], '/fixture', {
      contract: ['cached', 'failed', 'isolated'],
      isolatedContract: ['isolated'],
    });
    expect(result.coverage).toMatchObject({
      cacheHits: ['cached'],
      invoked: ['failed'],
      notInvoked: ['isolated'],
    });
    expect(result.status).toBe(1);
  } finally {
    process.exitCode = previousExitCode;
    output.mockRestore();
    errors.mockRestore();
  }
});

it('preserves the actual registry failure when promoting execution coverage', async () => {
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const errors = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const previousExitCode = process.exitCode;
  state.registryError = new Error('unresolved config input: settings.json');
  try {
    const result = await runAffectedContractTier([], '/fixture', {
      contract: ['cached', 'failed', 'isolated'],
      isolatedContract: ['isolated'],
    });
    expect(result.reason).toContain('unresolved config input: settings.json');
    expect(result.mode).toBe('complete');
  } finally {
    state.registryError = undefined;
    process.exitCode = previousExitCode;
    output.mockRestore();
    errors.mockRestore();
  }
});
