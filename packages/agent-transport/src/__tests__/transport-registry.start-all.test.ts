import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-transport/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TransportRegistry } from '../transport-registry.js';

import type {
  IInteractiveSession,
  ITransportRunnerAdapter,
  TTransportRunOutcome,
} from '@robota-sdk/agent-interface-transport';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function registryOverTempSettings(): TransportRegistry {
  const dir = mkdtempSync(path.join(tmpdir(), 'transport-registry-start-'));
  const file = path.join(dir, 'settings.json');
  writeFileSync(file, '{}');
  tempDirs.push(dir);
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
});
