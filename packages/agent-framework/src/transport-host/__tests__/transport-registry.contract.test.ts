import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createTransportFailedOutcome } from '@robota-sdk/agent-interface-transport';

import { TransportRegistry } from '../transport-registry.js';
import { bindTransportAdapter } from '../bind-transport-adapter.js';

import type {
  IConfigurableTransport,
  ITransportAdapter,
  ITransportRunnerAdapter,
  ITransportServiceAdapter,
  ITransportSettingsCapability,
  TBoundTransportAdapter,
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

function register(
  registry: TransportRegistry,
  adapter: TTransportAdapter<IInteractiveSession>,
  session: IInteractiveSession = createTestInteractiveSession(),
): void {
  registry.register(bindTransportAdapter(adapter, session));
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

    register(registry, service);

    expect(() => register(registry, createService('custom'))).toThrow(/duplicate.*custom/i);
  });

  it('rejects an unbound adapter at the runtime boundary', () => {
    const registry = createRegistry();
    const raw = createService('raw');
    expectTypeOf(raw).not.toMatchTypeOf<TBoundTransportAdapter>();
    expect(() => registry.register(raw as unknown as TBoundTransportAdapter)).toThrow(
      /must be bound before registration/,
    );
  });

  it('hosts adapters bound to different session capabilities', async () => {
    const registry = createRegistry();
    const calls: string[] = [];
    const emitPort = { emit: (value: string) => calls.push(`emit:${value}`) };
    const lookupPort = { lookup: () => 'answer' };
    const emitter: ITransportServiceAdapter<typeof emitPort> = {
      name: 'emitter',
      lifecycle: { kind: 'service' },
      attach: (session) => session.emit('ready'),
      start: async () => {},
      stop: async () => {},
    };
    const lookup: ITransportServiceAdapter<typeof lookupPort> = {
      name: 'lookup',
      lifecycle: { kind: 'service' },
      attach: (session) => calls.push(`lookup:${session.lookup()}`),
      start: async () => {},
      stop: async () => {},
    };

    expectTypeOf(emitter).not.toMatchTypeOf<TBoundTransportAdapter>();
    registry.register(bindTransportAdapter(emitter, emitPort));
    registry.register(bindTransportAdapter(lookup, lookupPort));
    await registry.startAll();

    expect(calls).toEqual(['emit:ready', 'lookup:answer']);
  });

  it('rejects runner/service discriminants whose runtime capabilities do not match', () => {
    const registry = createRegistry();
    const missingCompletion = {
      ...createService('broken'),
      lifecycle: Object.freeze({ kind: 'runner' as const }),
    };
    expectTypeOf(missingCompletion).not.toMatchTypeOf<TTransportAdapter<IInteractiveSession>>();
    expect(() =>
      registry.register({
        ...missingCompletion,
        binding: 'bound',
      } as unknown as TBoundTransportAdapter),
    ).toThrow(/invalid runner shape/i);

    const serviceWithCompletion = {
      ...createService('also-broken'),
      waitForCompletion: async () => ({ status: 'succeeded' as const, exitCode: 0 as const }),
    };
    expect(() =>
      registry.register({ ...serviceWithCompletion, binding: 'bound' } as TBoundTransportAdapter),
    ).toThrow(/invalid service shape/i);
  });

  it('projects only configurable transports into settings and rejects invalid mutations', async () => {
    const registry = createRegistry();
    register(registry, createService('base'));
    register(registry, createConfigurable('configurable'));

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
    register(registry, runner);

    expect(registry.getAll().map(({ transport }) => transport.name)).toEqual([
      'configurable-runner',
    ]);
    expect(registry.getEnabled().map(({ name }) => name)).toEqual([runner.name]);
  });
});

describe('TransportRegistry runner outcomes (ARCH-011)', () => {
  it('launches a runner without blocking a service and returns ordered completion records', async () => {
    const registry = createRegistry();
    const first = createControlledRunner('first');
    const service = createService('service');
    const second = createControlledRunner('second');
    register(registry, first);
    register(registry, service);
    register(registry, second);

    await registry.startAll();
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
    register(registry, failed);
    register(registry, pending);
    await registry.startAll();

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
    register(registry, immediate);
    register(registry, later);

    await registry.startAll();
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
    register(registry, success);
    await registry.startAll();
    success.complete({ status: 'succeeded', exitCode: 0 });
    await expect(registry.waitForFailure()).resolves.toBeUndefined();

    const next = createControlledRunner('next');
    const secondRegistry = createRegistry();
    register(secondRegistry, next);
    await secondRegistry.startAll();
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
    register(registry, runner);
    await registry.startAll();

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
    register(registry, first);
    await registry.startAll();
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
