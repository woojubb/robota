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
import { executionBatches } from '../verify-like-ci-scheduler.mjs';
import { CI_STAGES } from '../ci-mirror-map.mjs';

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

  it.each([
    'format-check',
    'commitlint',
    'scan-suite-dist-free',
    'harness-self-test',
    'harness-hermetic-test',
    'build',
  ])('blocks downstream checks after %s fails', async (name) => {
    vi.mocked(STAGE_RUNNERS[name]).mockResolvedValue({ code: 1 });
    await main(['--base-ref', 'selected-base']);
    if (['format-check', 'commitlint', 'scan-suite-dist-free'].includes(name))
      expect(STAGE_RUNNERS['harness-self-test']).not.toHaveBeenCalled();
    if (name !== 'build') expect(STAGE_RUNNERS.build).not.toHaveBeenCalled();
    expect(STAGE_RUNNERS['package-quality']).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(vi.mocked(process.stdout.write).mock.calls.flat().join('')).toContain('blocked');
  });

  it.each([
    ['format-check', 'commitlint'],
    ['harness-self-test', 'harness-hermetic-test'],
  ])(
    'settles concurrent %s and %s before restoring environment after throw',
    async (first, second) => {
      vi.stubEnv('HARNESS_BASE_REF', 'caller-base');
      let release;
      const pending = new Promise((resolve) => {
        release = resolve;
      });
      let entered = 0;
      vi.mocked(STAGE_RUNNERS[first]).mockImplementation(async () => {
        entered++;
        throw new Error('batch failure');
      });
      vi.mocked(STAGE_RUNNERS[second]).mockImplementation(async () => {
        entered++;
        await pending;
        expect(process.env.HARNESS_BASE_REF).toBe('selected-base');
        return { code: 0 };
      });
      let finished = false;
      const observed = main(['--base-ref', 'selected-base']).catch((error) => {
        finished = true;
        return error;
      });
      await vi.waitFor(() => expect(entered).toBe(2));
      expect(finished).toBe(false);
      expect(process.env.HARNESS_BASE_REF).toBe('selected-base');
      release();
      expect(await observed).toMatchObject({ message: 'batch failure' });
      expect(process.env.HARNESS_BASE_REF).toBe('caller-base');
      expect(STAGE_RUNNERS.build).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it('keeps build exclusive and counts nine actual batches for eleven checks', async () => {
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    vi.mocked(STAGE_RUNNERS.build).mockImplementation(async () => {
      await pending;
      return { code: 0 };
    });
    const invocation = main(['--base-ref', 'selected-base']);
    await vi.waitFor(() => expect(STAGE_RUNNERS.build).toHaveBeenCalledOnce());
    for (const name of [
      'scan-suite',
      'package-quality',
      'binary-e2e',
      'examples-typecheck',
      'tui-e2e',
    ])
      expect(STAGE_RUNNERS[name]).not.toHaveBeenCalled();
    release();
    await invocation;
    for (const runner of Object.values(STAGE_RUNNERS)) expect(runner).toHaveBeenCalledOnce();
    expect(vi.mocked(process.stdout.write).mock.calls.flat().join('')).toContain(
      '11 selected, 11 applicable, 11 executed; execution batches: 9',
    );
  });

  it('preserves only selection and refuses future unknown checks', async () => {
    await main(['--only', 'build']);
    expect(STAGE_RUNNERS.build).toHaveBeenCalledOnce();
    expect(STAGE_RUNNERS['format-check']).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(() => executionBatches(CI_STAGES, [...CI_STAGES, { name: 'future-check' }])).toThrow(
      'exactly once',
    );
  });
});
