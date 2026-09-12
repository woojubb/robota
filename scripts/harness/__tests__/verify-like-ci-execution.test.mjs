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

describe('local diagnostic execution base context', () => {
  it('has no automatic repository-contract, hermetic or dist-free runners', () => {
    for (const name of ['harness-self-test', 'harness-hermetic-test', 'scan-suite-dist-free']) {
      expect(STAGE_RUNNERS).not.toHaveProperty(name);
    }
  });
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

  it('propagates CLI precedence to every child without issuing a receipt, then restores the caller', async () => {
    vi.stubEnv('HARNESS_BASE_REF', 'caller-base');
    await main(['--base-ref', 'selected-base']);
    expect(observations).toHaveLength(Object.keys(STAGE_RUNNERS).length);
    expect(observations.every(([, base]) => base === 'selected-base')).toBe(true);
    expect(run).not.toHaveBeenCalled();
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

  it.each([{ argv: [] }, { argv: ['--full'] }, { argv: ['--only', 'format-check'] }])(
    'does not issue receipts or claim CI equivalence for $argv',
    async ({ argv }) => {
      await main(argv);
      expect(run).not.toHaveBeenCalled();
      const output = vi.mocked(process.stdout.write).mock.calls.flat().join('');
      expect(output).toContain('Local diagnostic only — NOT a CI-equivalent result');
      expect(output).toContain('scans — NOT mirrored locally');
      expect(output).not.toMatch(
        /required coverage satisfied|mirroring the required checks|before claiming the gate is green/,
      );
      expect(process.exitCode).toBe(0);
    },
  );

  it('restores caller context on an invalid-stage early return', async () => {
    vi.stubEnv('HARNESS_BASE_REF', 'caller-base');
    await main(['--base-ref', 'selected-base', '--only', 'unknown-stage']);
    expect(process.exitCode).toBe(1);
    expect(observations).toEqual([]);
    expect(process.env.HARNESS_BASE_REF).toBe('caller-base');
  });

  it.each([0, 1])(
    'keeps the format-only command and propagates exit %s without extra commands',
    async (code) => {
      vi.mocked(STAGE_RUNNERS['format-check']).mockRestore();
      vi.mocked(run).mockResolvedValue(code);
      await main(['--only', 'format-check', '--all-files']);
      expect(run).toHaveBeenCalledExactlyOnceWith('pnpm', [
        'exec',
        'prettier',
        '--check',
        expect.any(String),
      ]);
      expect(observations).toEqual([]);
      expect(process.exitCode).toBe(code);
      expect(vi.mocked(process.stdout.write).mock.calls.flat().join('')).toContain(
        'Local diagnostic only — NOT a CI-equivalent result',
      );
    },
  );

  it.each([0, 1])(
    'keeps only the built-output scan command and propagates exit %s',
    async (code) => {
      vi.mocked(STAGE_RUNNERS['scan-suite']).mockRestore();
      vi.mocked(run).mockResolvedValue(code);
      await main(['--only', 'scan-suite']);
      expect(run).toHaveBeenCalledExactlyOnceWith('pnpm', ['harness:scan:build-contracts']);
      expect(observations).toEqual([]);
      expect(process.exitCode).toBe(code);
      expect(vi.mocked(process.stdout.write).mock.calls.flat().join('')).toContain(
        'not pristine scan evidence',
      );
    },
  );

  it.each(['format-check', 'commitlint', 'build'])(
    'blocks downstream checks after %s fails',
    async (name) => {
      vi.mocked(STAGE_RUNNERS[name]).mockResolvedValue({ code: 1 });
      await main(['--base-ref', 'selected-base']);
      if (name !== 'build') expect(STAGE_RUNNERS.build).not.toHaveBeenCalled();
      expect(STAGE_RUNNERS['package-quality']).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(vi.mocked(process.stdout.write).mock.calls.flat().join('')).toContain('blocked');
    },
  );

  it.each([['format-check', 'commitlint']])(
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

  it('keeps build exclusive and counts seven actual batches for eight checks', async () => {
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
      '8 selected, 8 applicable, 8 executed; execution batches: 7',
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
