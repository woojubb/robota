import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTransportFailedOutcome } from '@robota-sdk/agent-interface-transport';

import { TransportRegistry } from '../transport-registry.js';

import type {
  ITransportRunnerAdapter,
  TTransportRunOutcome,
} from '@robota-sdk/agent-interface-transport';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function registryOverTempSettings(): TransportRegistry {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'transport-registry-start-')));
  const file = path.join(dir, 'settings.json');
  writeFileSync(file, '{}');
  tempDirs.push(dir);
  return new TransportRegistry(file);
}

function registryAtSettings(file: string): TransportRegistry {
  return new TransportRegistry(file);
}

function restartableRunner(): ITransportRunnerAdapter<IInteractiveSession> & {
  resolve(index: number, outcome: TTransportRunOutcome): void;
  reject(index: number, error?: unknown): void;
} {
  const completions: Array<Promise<TTransportRunOutcome>> = [];
  const resolvers: Array<(outcome: TTransportRunOutcome) => void> = [];
  const rejecters: Array<(error?: unknown) => void> = [];
  let run = -1;
  return {
    name: 'runner',
    lifecycle: Object.freeze({ kind: 'runner' }),
    attach: vi.fn(),
    start: async () => {
      run += 1;
      completions[run] = new Promise<TTransportRunOutcome>((resolve, reject) => {
        resolvers[run] = resolve;
        rejecters[run] = reject;
      });
    },
    stop: vi.fn().mockResolvedValue(undefined),
    waitForCompletion: () => completions[run]!,
    resolve: (index, outcome) => resolvers[index]!(outcome),
    reject: (index, error) => rejecters[index]!(error),
  };
}

describe('TransportRegistry generation ownership (ARCH-011)', () => {
  it('holds a runner rejection across a macrotask without an unhandled rejection', async () => {
    const registry = registryOverTempSettings();
    const runner = restartableRunner();
    registry.register(runner);
    await registry.startAll(createTestInteractiveSession());

    runner.reject(0, new Error('prompt failed'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect(registry.waitForCompletion()).rejects.toMatchObject({
      name: 'TransportLifecycleError',
      code: 'runner-rejected',
      transportName: 'runner',
    });
  });

  it('ignores a stale settlement after stop and preserves the current generation', async () => {
    const registry = registryOverTempSettings();
    const runner = restartableRunner();
    registry.register(runner);

    await registry.startAll(createTestInteractiveSession());
    await registry.stopAll();
    await registry.startAll(createTestInteractiveSession());

    runner.reject(0, new Error('stale failure'));
    runner.resolve(1, { status: 'succeeded', exitCode: 0 });

    await expect(registry.waitForCompletion()).resolves.toEqual([
      { name: 'runner', outcome: { status: 'succeeded', exitCode: 0 } },
    ]);
  });

  it('treats a rejection without a value as a lifecycle failure', async () => {
    const registry = registryOverTempSettings();
    const runner = restartableRunner();
    registry.register(runner);
    await registry.startAll(createTestInteractiveSession());

    runner.reject(0);

    await expect(registry.waitForFailure()).rejects.toMatchObject({
      name: 'TransportLifecycleError',
      code: 'runner-rejected',
    });
  });

  it('rejects an active second start before attaching or replacing the generation', async () => {
    const registry = registryOverTempSettings();
    const runner = restartableRunner();
    registry.register(runner);
    const session = createTestInteractiveSession();
    await registry.startAll(session);
    const completion = registry.waitForCompletion();

    await expect(registry.startAll(session)).rejects.toMatchObject({ code: 'already-started' });
    expect(runner.attach).toHaveBeenCalledTimes(1);
    runner.resolve(0, createTransportFailedOutcome(3));
    await expect(completion).resolves.toEqual([
      { name: 'runner', outcome: { status: 'failed', exitCode: 3 } },
    ]);
  });

  it('remains idle when settings resolution fails before startup begins', async () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'transport-registry-settings-')));
    const file = path.join(dir, 'settings.json');
    tempDirs.push(dir);
    writeFileSync(file, '{');
    const registry = registryAtSettings(file);
    registry.register(restartableRunner());

    await expect(registry.startAll(createTestInteractiveSession())).rejects.toBeDefined();
    writeFileSync(file, '{}');
    await expect(registry.startAll(createTestInteractiveSession())).resolves.toBeUndefined();
  });

  it('coalesces concurrent stop calls into one transport stop traversal', async () => {
    const registry = registryOverTempSettings();
    let release!: () => void;
    const service = {
      name: 'service',
      lifecycle: Object.freeze({ kind: 'service' as const }),
      attach: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(() => new Promise<void>((resolve) => (release = resolve))),
    };
    registry.register(service);
    await registry.startAll(createTestInteractiveSession());

    const first = registry.stopAll();
    const second = registry.stopAll();
    expect(service.stop).toHaveBeenCalledTimes(1);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([{ errors: [] }, { errors: [] }]);
    expect(service.stop).toHaveBeenCalledTimes(1);
  });

  it('rolls back from the failing adapter in reverse order and preserves safe rollback errors', async () => {
    const registry = registryOverTempSettings();
    const order: string[] = [];
    const first = {
      name: 'first',
      lifecycle: Object.freeze({ kind: 'service' as const }),
      attach: vi.fn(),
      start: async () => {
        order.push('start:first');
      },
      stop: async () => {
        order.push('stop:first');
        throw new Error('first rollback failed');
      },
    };
    const failing = {
      name: 'failing',
      lifecycle: Object.freeze({ kind: 'service' as const }),
      attach: vi.fn(),
      start: async () => {
        order.push('start:failing');
        throw new Error('primary startup failure');
      },
      stop: async () => {
        order.push('stop:failing');
      },
    };
    registry.register(first);
    registry.register(failing);

    const error = await registry.startAll(createTestInteractiveSession()).catch((cause) => cause);
    expect(error).toMatchObject({
      name: 'TransportStartupError',
      transportName: 'failing',
      rollbackErrors: [
        {
          transportName: 'first',
          message: 'Transport stop failed during startup rollback.',
        },
      ],
    });
    expect(Object.keys(error as object)).not.toContain('cause');
    expect(Object.keys(error as object)).not.toContain('rollbackCauses');
    expect((error as Error & { cause?: unknown }).cause).toMatchObject({
      message: 'primary startup failure',
    });
    expect((error as { rollbackCauses?: readonly Error[] }).rollbackCauses?.[0]).toMatchObject({
      message: 'first rollback failed',
    });
    expect(order).toEqual(['start:first', 'start:failing', 'stop:failing', 'stop:first']);
    await expect(registry.waitForFailure()).resolves.toBeUndefined();
  });

  it('serializes stop during startup and never starts a later adapter', async () => {
    const registry = registryOverTempSettings();
    let rejectStart!: (error: Error) => void;
    const starting = {
      name: 'starting',
      lifecycle: Object.freeze({ kind: 'service' as const }),
      attach: vi.fn(),
      start: () =>
        new Promise<void>((_resolve, reject) => {
          rejectStart = reject;
        }),
      stop: vi.fn(async () => rejectStart(new Error('stopped while starting'))),
    };
    const later = {
      name: 'later',
      lifecycle: Object.freeze({ kind: 'service' as const }),
      attach: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    registry.register(starting);
    registry.register(later);

    const start = registry.startAll(createTestInteractiveSession());
    await Promise.resolve();
    const stop = registry.stopAll();

    await expect(start).rejects.toMatchObject({
      name: 'TransportStartupError',
      transportName: 'starting',
    });
    await expect(stop).resolves.toMatchObject({ errors: [] });
    expect(later.start).not.toHaveBeenCalled();
  });

  it('preserves a preemption stop failure even when the rollback retry succeeds', async () => {
    const registry = registryOverTempSettings();
    let resolveStart!: () => void;
    let stops = 0;
    const starting = {
      name: 'starting',
      lifecycle: Object.freeze({ kind: 'service' as const }),
      attach: vi.fn(),
      start: () => new Promise<void>((resolve) => (resolveStart = resolve)),
      stop: vi.fn(async () => {
        stops += 1;
        if (stops === 1) {
          resolveStart();
          throw new Error('credential=private');
        }
      }),
    };
    registry.register(starting);
    const start = registry.startAll(createTestInteractiveSession());
    await Promise.resolve();
    const stop = registry.stopAll();

    const error = await start.catch((cause) => cause);
    expect(error).toMatchObject({
      rollbackErrors: [
        {
          transportName: 'starting',
          message: 'Transport stop failed during startup rollback.',
        },
      ],
    });
    expect(JSON.stringify(error)).not.toContain('credential=private');
    expect((error as { rollbackCauses?: readonly Error[] }).rollbackCauses?.[0]?.message).toBe(
      'credential=private',
    );
    await expect(stop).resolves.toEqual({ errors: [] });
  });

  it('terminalizes every pending runner as startup-rollback in registration order', async () => {
    const registry = registryOverTempSettings();
    const runner = restartableRunner();
    const failing = {
      name: 'failing',
      lifecycle: Object.freeze({ kind: 'service' as const }),
      attach: vi.fn(),
      start: vi.fn(async () => Promise.reject(new Error('boom'))),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    registry.register(runner);
    registry.register(failing);

    await expect(registry.startAll(createTestInteractiveSession())).rejects.toMatchObject({
      name: 'TransportStartupError',
    });
    await expect(registry.waitForCompletion()).resolves.toEqual([
      { name: 'runner', outcome: { status: 'abandoned', reason: 'startup-rollback' } },
    ]);
    await expect(registry.waitForFailure()).resolves.toBeUndefined();
    runner.resolve(0, createTransportFailedOutcome(4));
    await expect(registry.waitForCompletion()).resolves.toEqual([
      { name: 'runner', outcome: { status: 'abandoned', reason: 'startup-rollback' } },
    ]);
  });
});
