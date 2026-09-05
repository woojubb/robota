import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createTransportFailedOutcome } from '@robota-sdk/agent-interface-transport';

import { TransportRegistry } from '../transport-registry.js';

import type {
  IConfigurableTransport,
  ITransportAdapter,
  ITransportRunnerAdapter,
  ITransportServiceAdapter,
  ITransportSettingsCapability,
  TTransportAdapter,
  TTransportRunOutcome,
} from '@robota-sdk/agent-interface-transport';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createRegistry(): TransportRegistry {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'transport-registry-contract-')));
  const settingsPath = path.join(dir, 'settings.json');
  writeFileSync(settingsPath, '{}');
  tempDirs.push(dir);
  return new TransportRegistry(settingsPath);
}

function createService(name: string): ITransportServiceAdapter<IInteractiveSession> {
  return {
    name,
    lifecycle: Object.freeze({ kind: 'service' }),
    attach: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

function createConfigurable(name: string): IConfigurableTransport<IInteractiveSession> {
  return {
    ...createService(name),
    defaultEnabled: true,
  };
}

function createConfigurableRunner(
  name: string,
): ITransportRunnerAdapter<IInteractiveSession> & ITransportSettingsCapability {
  return {
    ...createControlledRunner(name),
    defaultEnabled: true,
  };
}

function createControlledRunner(name: string): ITransportRunnerAdapter<IInteractiveSession> & {
  complete(outcome: TTransportRunOutcome): void;
  reject(error: unknown): void;
} {
  let resolve!: (outcome: TTransportRunOutcome) => void;
  let reject!: (error: unknown) => void;
  const completion = new Promise<TTransportRunOutcome>((resolveCompletion, rejectCompletion) => {
    resolve = resolveCompletion;
    reject = rejectCompletion;
  });
  return {
    name,
    lifecycle: Object.freeze({ kind: 'runner' }),
    attach: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    waitForCompletion: () => completion,
    complete: resolve,
    reject,
  };
}

describe('TransportRegistry lifecycle/settings segregation (ARCH-011)', () => {
  it('registers a base adapter without casts and rejects duplicate runtime names', () => {
    const registry = createRegistry();
    const service = createService('custom');

    registry.register(service);

    expect(() => registry.register(createService('custom'))).toThrow(/duplicate.*custom/i);
  });

  it('rejects runner/service discriminants whose runtime capabilities do not match', () => {
    const registry = createRegistry();
    const missingCompletion = {
      ...createService('broken'),
      lifecycle: Object.freeze({ kind: 'runner' as const }),
    };
    expectTypeOf(missingCompletion).not.toMatchTypeOf<TTransportAdapter<IInteractiveSession>>();
    expect(() =>
      registry.register(missingCompletion as unknown as TTransportAdapter<IInteractiveSession>),
    ).toThrow(/invalid runner shape/i);

    const serviceWithCompletion = {
      ...createService('also-broken'),
      waitForCompletion: async () => ({ status: 'succeeded' as const, exitCode: 0 as const }),
    };
    expect(() =>
      registry.register(serviceWithCompletion as unknown as TTransportAdapter<IInteractiveSession>),
    ).toThrow(/invalid service shape/i);
  });

  it('projects only configurable transports into settings and rejects invalid mutations', async () => {
    const registry = createRegistry();
    registry.register(createService('base'));
    registry.register(createConfigurable('configurable'));

    expect(registry.getAll().map(({ transport }) => transport.name)).toEqual(['configurable']);
    await expect(registry.setEnabled('base', false)).rejects.toMatchObject({
      name: 'TransportConfigurationError',
      code: 'not-configurable',
      transportName: 'base',
    });
    await expect(registry.setOptions('missing', {})).rejects.toMatchObject({
      name: 'TransportConfigurationError',
      code: 'unknown-transport',
      transportName: 'missing',
    });
  });

  it('keeps configuration orthogonal to the runner/service lifecycle discriminant', () => {
    const registry = createRegistry();
    const runner = createConfigurableRunner('configurable-runner');
    registry.register(runner);

    expect(registry.getAll().map(({ transport }) => transport.name)).toEqual([
      'configurable-runner',
    ]);
    expect(registry.getEnabled()).toEqual([runner]);
  });
});

describe('TransportRegistry runner outcomes (ARCH-011)', () => {
  it('launches a runner without blocking a service and returns ordered completion records', async () => {
    const registry = createRegistry();
    const first = createControlledRunner('first');
    const service = createService('service');
    const second = createControlledRunner('second');
    registry.register(first);
    registry.register(service);
    registry.register(second);

    await registry.startAll(createTestInteractiveSession());
    expect(service.start).toHaveBeenCalledTimes(1);

    second.complete({ status: 'succeeded', exitCode: 0 });
    first.complete(createTransportFailedOutcome(2));

    await expect(registry.waitForCompletion()).resolves.toEqual([
      { name: 'first', outcome: { status: 'failed', exitCode: 2 } },
      { name: 'second', outcome: { status: 'succeeded', exitCode: 0 } },
    ]);
  });

  it('reports the first failed outcome without waiting for another runner', async () => {
    const registry = createRegistry();
    const failed = createControlledRunner('failed');
    const pending = createControlledRunner('pending');
    registry.register(failed);
    registry.register(pending);
    await registry.startAll(createTestInteractiveSession());

    failed.complete(createTransportFailedOutcome(7));

    await expect(registry.waitForFailure()).resolves.toEqual({
      name: 'failed',
      outcome: { status: 'failed', exitCode: 7 },
    });
  });

  it('does not declare all-success before every runner in the startup generation is registered', async () => {
    const registry = createRegistry();
    const immediate: ITransportRunnerAdapter<IInteractiveSession> = {
      name: 'immediate',
      lifecycle: Object.freeze({ kind: 'runner' }),
      attach: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      waitForCompletion: async () => ({ status: 'succeeded', exitCode: 0 }),
    };
    const later = createControlledRunner('later');
    registry.register(immediate);
    registry.register(later);

    await registry.startAll(createTestInteractiveSession());
    const failure = registry.waitForFailure();
    later.complete(createTransportFailedOutcome(9));

    await expect(failure).resolves.toEqual({
      name: 'later',
      outcome: { status: 'failed', exitCode: 9 },
    });
  });

  it('resolves failure waiting as undefined when every runner succeeds or stop abandons the run', async () => {
    const registry = createRegistry();
    const success = createControlledRunner('success');
    registry.register(success);
    await registry.startAll(createTestInteractiveSession());
    success.complete({ status: 'succeeded', exitCode: 0 });
    await expect(registry.waitForFailure()).resolves.toBeUndefined();

    const next = createControlledRunner('next');
    const secondRegistry = createRegistry();
    secondRegistry.register(next);
    await secondRegistry.startAll(createTestInteractiveSession());
    const failureWait = secondRegistry.waitForFailure();
    const completionWait = secondRegistry.waitForCompletion();
    await secondRegistry.stopAll();
    await expect(failureWait).resolves.toBeUndefined();
    await expect(completionWait).resolves.toEqual([
      { name: 'next', outcome: { status: 'abandoned', reason: 'stopped' } },
    ]);
  });

  it('rejects malformed runner outcomes at the runtime trust boundary', async () => {
    const registry = createRegistry();
    const runner = createControlledRunner('invalid');
    registry.register(runner);
    await registry.startAll(createTestInteractiveSession());

    runner.complete({ status: 'failed', exitCode: 0 } as unknown as TTransportRunOutcome);

    await expect(registry.waitForCompletion()).rejects.toMatchObject({
      name: 'TransportLifecycleError',
      code: 'runner-rejected',
      transportName: 'invalid',
    });
  });

  it('converts runner promise rejection to a stable lifecycle error', async () => {
    const registry = createRegistry();
    const first = createControlledRunner('runner');
    registry.register(first);
    await registry.startAll(createTestInteractiveSession());
    first.reject(new Error('private failure'));

    await expect(registry.waitForFailure()).rejects.toMatchObject({
      name: 'TransportLifecycleError',
      code: 'runner-rejected',
      transportName: 'runner',
    });

    await expect(registry.waitForCompletion()).rejects.toMatchObject({
      name: 'TransportLifecycleError',
      code: 'runner-rejected',
      transportName: 'runner',
    });
  });
});
