import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HostedRuntimeController } from '../hosted-runtime-controller.js';
import { hostedFixture } from './hosted-fixture.js';
import type { IHostedRuntimeExecutor } from '../hosted-runtime-types.js';

const fixtures: Awaited<ReturnType<typeof hostedFixture>>[] = [];
async function fixture() {
  const value = await hostedFixture();
  fixtures.push(value);
  return value;
}
afterEach(async () => {
  vi.useRealTimers();
  for (const value of fixtures.splice(0)) await value.close();
  vi.restoreAllMocks();
});

function immediateExecutor(): IHostedRuntimeExecutor {
  return {
    run: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  };
}

describe('hosted runtime ownership and lifecycle', () => {
  it('owns observed session/model usage, execution completion and exactly one teardown', async () => {
    const value = await fixture();
    value.setUsage({ sessions: 1, modelCalls: 2, modelTokens: 30, costMicros: 400 });
    const executor = immediateExecutor();
    executor.run = vi.fn(async (_admission, control) => {
      control.observe({ sessions: 1, modelCalls: 2, modelTokens: 30, costMicros: 400 });
    });
    const controller = new HostedRuntimeController({
      environment: value.environment,
      resume: false,
      createExecutor: async () => executor,
    });
    await controller.run();
    expect(controller.status()).toEqual({
      state: 'stopped',
      usage: { sessions: 1, modelCalls: 2, modelTokens: 30, costMicros: 400 },
    });
    await controller.stop('again');
    expect(executor.stop).toHaveBeenCalledOnce();
    expect(executor.release).toHaveBeenCalledOnce();
    await expect(controller.run()).rejects.toThrow(/cannot reuse/);
  });

  it('owns broker-signed cumulative observations without executor-injected counters', async () => {
    const value = await fixture();
    const usage = { sessions: 1, modelCalls: 2, modelTokens: 30, costMicros: 400 };
    value.setProofTransform((proof) => ({ ...proof, usage: proof.role === 'broker' ? usage : null }));
    const controller = new HostedRuntimeController({
      environment: value.environment, resume: false, createExecutor: async () => immediateExecutor(),
    });
    await controller.run();
    expect(controller.status()).toEqual({ state: 'stopped', usage });
  });

  it('refuses exhausted broker-observed budget before allocating an executor', async () => {
    const value = await fixture();
    value.writeConfig({ ...value.config, limits: { sessions: 1, modelCalls: 1, modelTokens: 30, costMicros: 400 } });
    value.setProofTransform((proof) => ({ ...proof, usage: proof.role === 'broker'
      ? { sessions: 1, modelCalls: 2, modelTokens: 30, costMicros: 400 } : null }));
    const createExecutor = vi.fn(async () => immediateExecutor());
    const controller = new HostedRuntimeController({ environment: value.environment, resume: false, createExecutor });
    await expect(controller.run()).rejects.toThrow(/usage limit/u);
    expect(createExecutor).not.toHaveBeenCalled();
  });

  it('does not provision or execute after failed worker/broker admission', async () => {
    const value = await fixture();
    value.setUnavailable('broker');
    const createExecutor = vi.fn(async () => immediateExecutor());
    const controller = new HostedRuntimeController({
      environment: value.environment,
      resume: false,
      createExecutor,
    });
    await expect(controller.run()).rejects.toThrow(/broker backend/);
    expect(createExecutor).not.toHaveBeenCalled();
    expect(controller.status().state).toBe('failed');
  });

  it('preserves a factory refusal when no executor was allocated', async () => {
    const value = await fixture();
    const controller = new HostedRuntimeController({
      environment: value.environment,
      resume: false,
      createExecutor: async () => {
        throw new Error('task worker execution adapter is unavailable');
      },
    });
    await expect(controller.run()).rejects.toThrow('task worker execution adapter is unavailable');
    expect(controller.status().state).toBe('failed');
  });

  it('bounds a hung provision without claiming cleanup, then cleans a late resource', async () => {
    const value = await fixture();
    const executor = immediateExecutor();
    let provision!: (value: IHostedRuntimeExecutor) => void;
    const held = new Promise<IHostedRuntimeExecutor>((resolve) => {
      provision = resolve;
    });
    const createExecutor = vi.fn(async () => held);
    const controller = new HostedRuntimeController({
      environment: value.environment,
      resume: false,
      createExecutor,
    });
    const running = controller.run().catch((error: Error) => error);
    await vi.waitFor(() => expect(createExecutor).toHaveBeenCalledOnce());
    vi.useFakeTimers();
    const stopping = controller.stop('during hung provisioning').catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(5001);
    expect(((await stopping) as Error).message).toContain('resource cleanup failed');
    expect(((await running) as Error).message).toContain('resource cleanup failed');
    expect(controller.status().state).toBe('failed');
    expect(executor.release).not.toHaveBeenCalled();
    provision(executor);
    await vi.advanceTimersByTimeAsync(0);
    expect(executor.run).not.toHaveBeenCalled();
    expect(executor.stop).toHaveBeenCalledOnce();
    expect(executor.release).toHaveBeenCalledOnce();
    expect(controller.status().state).toBe('failed');
  });

  it('denies malformed or decreasing usage observations', async () => {
    const value = await fixture();
    const executor = immediateExecutor();
    executor.run = vi.fn(async (_admission, control) => {
      control.observe({ sessions: 1, modelCalls: 1, modelTokens: 10, costMicros: 20 });
      control.observe({ sessions: 1, modelCalls: 1, modelTokens: 9, costMicros: 20 });
    });
    const controller = new HostedRuntimeController({
      environment: value.environment,
      resume: false,
      createExecutor: async () => executor,
    });
    await expect(controller.run()).rejects.toThrow(/moved backward/);
    expect(executor.release).toHaveBeenCalledOnce();
  });

  it('waits for an in-flight provision and cleans the resulting resource before stop settles', async () => {
    const value = await fixture();
    const executor = immediateExecutor();
    let provision!: (value: IHostedRuntimeExecutor) => void;
    const held = new Promise<IHostedRuntimeExecutor>((resolve) => {
      provision = resolve;
    });
    const createExecutor = vi.fn(async () => held);
    const controller = new HostedRuntimeController({
      environment: value.environment,
      resume: false,
      createExecutor,
    });
    const running = controller.run().catch((error: Error) => error);
    await vi.waitFor(() => expect(createExecutor).toHaveBeenCalledOnce());
    let finished = false;
    const stopping = controller.stop('during provisioning').then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    provision(executor);
    await stopping;
    expect(await running).toBeInstanceOf(Error);
    expect(executor.run).not.toHaveBeenCalled();
    expect(executor.stop).toHaveBeenCalledOnce();
    expect(executor.release).toHaveBeenCalledOnce();
  });

  it('stops a real owned child process when the runtime lifetime is exhausted', async () => {
    const value = await fixture();
    value.writeConfig({ ...value.config, lifetimeMs: 150 });
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: value.directory,
      env: {},
      stdio: 'ignore',
    });
    const exited = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', () => resolve());
    });
    const stop = vi.fn(async () => {
      child.kill('SIGTERM');
      await exited;
    });
    const release = vi.fn(async () => undefined);
    const controller = new HostedRuntimeController({
      environment: value.environment,
      resume: false,
      createExecutor: async () => ({ run: async () => exited, stop, release }),
    });
    try {
      await expect(controller.run()).rejects.toThrow(/lifetime exhausted/);
      expect(stop).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledOnce();
      expect(() => process.kill(child.pid!, 0)).toThrow();
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    }
  });

  it('stops active execution when a current broker epoch cannot be verified', async () => {
    const value = await fixture();
    value.setProofTransform((proof) => ({ ...proof, expiresAt: Date.now() + 1000 }));
    const executor = immediateExecutor();
    executor.run = vi.fn(async () => new Promise<void>(() => undefined));
    const controller = new HostedRuntimeController({
      environment: value.environment,
      resume: false,
      createExecutor: async () => executor,
    });
    const running = controller.run().catch((error: Error) => error);
    await vi.waitFor(() => expect(executor.run).toHaveBeenCalledOnce());
    value.setProofTransform((proof) => ({ ...proof, epoch: 2, expiresAt: Date.now() + 1000 }));
    expect(((await running) as Error).message).toContain('admission was lost');
    expect(executor.stop).toHaveBeenCalledOnce();
    expect(executor.release).toHaveBeenCalledOnce();
  });

  it.each(['sessions', 'modelCalls', 'modelTokens', 'costMicros'] as const)(
    'stops a real owned process when refreshed %s exceeds the owner limit', async (key) => {
      const value = await fixture();
      value.setProofLifetime(1000);
      value.writeConfig({ ...value.config, limits: { ...value.config.limits, [key]: 1 } });
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        cwd: value.directory, env: {}, stdio: 'ignore',
      });
      const exited = new Promise<void>((resolve, reject) => {
        child.once('error', reject); child.once('exit', () => resolve());
      });
      const run = vi.fn(async () => exited);
      const stop = vi.fn(async () => { child.kill('SIGTERM'); await exited; });
      const release = vi.fn(async () => undefined);
      const controller = new HostedRuntimeController({ environment: value.environment, resume: false,
        createExecutor: async () => ({ run, stop, release }),
      });
      try {
        const running = controller.run().catch((error: Error) => error);
        await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
        value.setUsage({ ...value.usage(), [key]: 2 });
        expect(((await running) as Error).message).toContain('usage limit exhausted');
        expect(controller.status().usage[key]).toBe(2);
        expect(stop).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
        expect(() => process.kill(child.pid!, 0)).toThrow();
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await exited;
      }
    },
  );

  it('collects final accounting after a short execution before reporting success', async () => {
    const value = await fixture();
    const executor = immediateExecutor();
    executor.run = vi.fn(async () => value.setUsage({ sessions: 1, modelCalls: 3, modelTokens: 6, costMicros: 9 }));
    const controller = new HostedRuntimeController({ environment: value.environment, resume: false,
      createExecutor: async () => executor });
    await controller.run();
    expect(controller.status().usage).toEqual(value.usage());
    expect(controller.status().usage.modelCalls).toBe(3);
    expect(executor.release).toHaveBeenCalledOnce();
  });

  it('refuses success when final broker accounting is unavailable and still releases the worker', async () => {
    const value = await fixture();
    const executor = immediateExecutor();
    executor.run = vi.fn(async () => value.setUnavailable('broker'));
    const controller = new HostedRuntimeController({ environment: value.environment, resume: false,
      createExecutor: async () => executor });
    await expect(controller.run()).rejects.toThrow(/broker backend/u);
    expect(executor.stop).toHaveBeenCalledOnce(); expect(executor.release).toHaveBeenCalledOnce();
  });

  it('refuses a current signed accounting regression on refresh', async () => {
    const value = await fixture();
    value.setProofLifetime(1000);
    value.setUsage({ sessions: 1, modelCalls: 2, modelTokens: 4, costMicros: 6 });
    const executor = immediateExecutor();
    executor.run = vi.fn(async () => new Promise<void>(() => undefined));
    const controller = new HostedRuntimeController({ environment: value.environment, resume: false,
      createExecutor: async () => executor });
    const running = controller.run().catch((error: Error) => error);
    await vi.waitFor(() => expect(executor.run).toHaveBeenCalledOnce());
    value.setUsage({ sessions: 1, modelCalls: 1, modelTokens: 4, costMicros: 6 });
    expect(((await running) as Error).message).toContain('accounting moved backward');
    expect(executor.release).toHaveBeenCalledOnce();
  });

  it('still attempts release when stop fails and reports failed cleanup', async () => {
    const value = await fixture();
    const executor = immediateExecutor();
    executor.stop = vi.fn(async () => {
      throw new Error('synthetic stop failure');
    });
    const controller = new HostedRuntimeController({
      environment: value.environment,
      resume: false,
      createExecutor: async () => executor,
    });
    await expect(controller.run()).rejects.toThrow(/resource cleanup failed/);
    expect(executor.release).toHaveBeenCalledOnce();
    expect(controller.status().state).toBe('failed');
  });

  it('requires fresh admission on restart rather than resurrecting an old grant', async () => {
    const value = await fixture();
    const firstExecutor = immediateExecutor();
    const first = new HostedRuntimeController({
      environment: value.environment,
      resume: false,
      createExecutor: async () => firstExecutor,
    });
    await first.run();
    value.setProofTransform((proof) => ({ ...proof, epoch: 2 }));
    const createExecutor = vi.fn(async () => immediateExecutor());
    const next = await first.restart({
      environment: value.environment,
      resume: false,
      createExecutor,
    });
    await expect(next.run()).rejects.toThrow(/epoch/);
    expect(createExecutor).not.toHaveBeenCalled();
    expect(firstExecutor.release).toHaveBeenCalledOnce();
  });
});
