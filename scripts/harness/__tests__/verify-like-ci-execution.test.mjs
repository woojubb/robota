import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../verify-like-ci-product.mjs', async (original) => ({
  ...(await original()),
  preflight: () => ({ ok: true }),
  resolveRunContext: vi.fn(async () => ({ changedFiles: [], productChanged: false })),
  stageGate: () => ({ run: true }),
  initialBuildState: () => ({}),
  blockedStageResult: () => null,
  advanceBuildState: () => ({}),
}));
vi.mock('../verification-receipt.mjs', async (original) => ({
  ...(await original()),
  realDirtyLines: () => [],
}));
vi.mock('../verify-like-ci-shared.mjs', async (original) => ({
  ...(await original()),
  run: vi.fn(async () => 0),
}));
vi.mock('../shared.mjs', async (original) => ({
  ...(await original()),
  appendJobSummary: vi.fn(),
}));

import { main, STAGE_RUNNERS } from '../verify-like-ci-execution.mjs';
import { run } from '../verify-like-ci-shared.mjs';

describe('CI mirror execution base context', () => {
  const observations = [];
  let previousExit;
  beforeEach(() => {
    previousExit = process.exitCode;
    observations.length = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    for (const name of Object.keys(STAGE_RUNNERS)) {
      vi.spyOn(STAGE_RUNNERS, name).mockImplementation(async () => {
        const child = spawnSync(
          process.execPath,
          ['-e', 'process.stdout.write(process.env.HARNESS_BASE_REF ?? "absent")'],
          { encoding: 'utf8' },
        );
        expect(child.status).toBe(0);
        observations.push([name, child.stdout]);
        return { code: 0 };
      });
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(run).mockReset().mockResolvedValue(0);
    process.exitCode = previousExit;
  });

  it('propagates CLI precedence to every child and receipt, then restores the caller', async () => {
    vi.stubEnv('HARNESS_BASE_REF', 'caller-base');
    vi.mocked(run).mockImplementation(async (_command, args) => {
      expect(process.env.HARNESS_BASE_REF).toBe('selected-base');
      expect(args.slice(args.indexOf('--base-ref'), args.indexOf('--base-ref') + 2)).toEqual([
        '--base-ref',
        'selected-base',
      ]);
      return 0;
    });
    await main(['--base-ref', 'selected-base']);
    expect(observations).toHaveLength(Object.keys(STAGE_RUNNERS).length);
    expect(observations.every(([, base]) => base === 'selected-base')).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(process.env.HARNESS_BASE_REF).toBe('caller-base');
    expect(process.exitCode).toBe(0);
  });

  it.each([
    ['success', undefined],
    ['failure', undefined],
    ['throw', undefined],
    ['success', 'caller-base'],
    ['failure', 'caller-base'],
    ['throw', 'caller-base'],
  ])('restores original base after %s with original %s', async (outcome, original) => {
    vi.stubEnv('HARNESS_BASE_REF', original);
    vi.mocked(STAGE_RUNNERS['format-check']).mockImplementation(async () => {
      expect(process.env.HARNESS_BASE_REF).toBe('selected-base');
      if (outcome === 'throw') throw new Error('stage exploded');
      return { code: outcome === 'failure' ? 1 : 0 };
    });
    const invocation = main(['--base-ref', 'selected-base', '--only', 'format-check']);
    if (outcome === 'throw') await expect(invocation).rejects.toThrow('stage exploded');
    else {
      await invocation;
      expect(process.exitCode).toBe(outcome === 'failure' ? 1 : 0);
    }
    expect(process.env.HARNESS_BASE_REF).toBe(original);
    expect(Object.hasOwn(process.env, 'HARNESS_BASE_REF')).toBe(original !== undefined);
  });

  it('restores caller context when receipt creation throws', async () => {
    vi.stubEnv('HARNESS_BASE_REF', 'caller-base');
    vi.mocked(run).mockImplementation(async () => {
      expect(process.env.HARNESS_BASE_REF).toBe('selected-base');
      throw new Error('receipt failed');
    });
    await expect(main(['--base-ref', 'selected-base'])).rejects.toThrow('receipt failed');
    expect(process.env.HARNESS_BASE_REF).toBe('caller-base');
  });

  it('restores caller context on an invalid-stage early return', async () => {
    vi.stubEnv('HARNESS_BASE_REF', 'caller-base');
    await main(['--base-ref', 'selected-base', '--only', 'unknown-stage']);
    expect(process.exitCode).toBe(1);
    expect(observations).toEqual([]);
    expect(process.env.HARNESS_BASE_REF).toBe('caller-base');
  });
});
