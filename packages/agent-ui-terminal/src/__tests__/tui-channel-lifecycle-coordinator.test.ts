import { describe, expect, it, vi } from 'vitest';

import { TuiChannelLifecycleCoordinator } from '../tui-channel-lifecycle-coordinator.js';

function operations() {
  return {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    beginShutdown: vi.fn(),
    shutdownSession: vi.fn(async () => {}),
  };
}

describe('TuiChannelLifecycleCoordinator', () => {
  it('starts and stops idempotently, including one discard shutdown', async () => {
    const ops = operations();
    const lifecycle = new TuiChannelLifecycleCoordinator(ops, 100);
    await lifecycle.start();
    await lifecycle.start();
    await lifecycle.stop();
    await lifecycle.stop();

    expect(ops.start).toHaveBeenCalledTimes(1);
    expect(ops.stop).toHaveBeenCalledTimes(1);
    expect(ops.shutdownSession).toHaveBeenCalledTimes(1);
    expect(ops.shutdownSession).toHaveBeenCalledWith({
      reason: 'other',
      message: 'channel stopped',
    });
  });

  it('does not repeat a graceful shutdown when stop follows it', async () => {
    const ops = operations();
    const lifecycle = new TuiChannelLifecycleCoordinator(ops, 100);
    await lifecycle.shutdown({ reason: 'prompt_input_exit' });
    await lifecycle.shutdown({ reason: 'other' });
    await lifecycle.stop();

    expect(lifecycle.isShuttingDown).toBe(true);
    expect(ops.beginShutdown).toHaveBeenCalledTimes(1);
    expect(ops.shutdownSession).toHaveBeenCalledTimes(1);
  });

  it('allows a failed start to be retried', async () => {
    const ops = operations();
    ops.start.mockRejectedValueOnce(new Error('transport start failed'));
    const lifecycle = new TuiChannelLifecycleCoordinator(ops, 100);

    await expect(lifecycle.start()).rejects.toThrow('transport start failed');
    await lifecycle.start();
    await lifecycle.start();

    expect(ops.start).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight start across concurrent callers', async () => {
    const ops = operations();
    let release: (() => void) | undefined;
    ops.start.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    const lifecycle = new TuiChannelLifecycleCoordinator(ops, 100);

    const first = lifecycle.start();
    const second = lifecycle.start();
    expect(ops.start).toHaveBeenCalledTimes(1);
    release?.();
    await Promise.all([first, second]);
  });

  it('waits for an in-flight start before tearing the channel down', async () => {
    const ops = operations();
    let release: (() => void) | undefined;
    ops.start.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    const lifecycle = new TuiChannelLifecycleCoordinator(ops, 100);

    const start = lifecycle.start();
    const stop = lifecycle.stop();
    await Promise.resolve();
    expect(ops.stop).not.toHaveBeenCalled();

    release?.();
    await Promise.all([start, stop]);
    expect(ops.start.mock.invocationCallOrder[0]).toBeLessThan(
      ops.stop.mock.invocationCallOrder[0]!,
    );
  });

  it('surfaces an in-flight start failure after teardown completes', async () => {
    const ops = operations();
    let rejectStart: ((error: Error) => void) | undefined;
    ops.start.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => (rejectStart = reject)),
    );
    const lifecycle = new TuiChannelLifecycleCoordinator(ops, 100);

    const start = lifecycle.start();
    const stop = lifecycle.stop();
    rejectStart?.(new Error('transport start failed'));

    await expect(start).rejects.toThrow('transport start failed');
    await expect(stop).rejects.toThrow('transport start failed');
    expect(ops.stop).toHaveBeenCalledTimes(1);
    await lifecycle.stop();
    expect(ops.stop).toHaveBeenCalledTimes(1);
  });

  it('preserves concurrent start and teardown errors and keeps teardown retryable', async () => {
    const ops = operations();
    let rejectStart: ((error: Error) => void) | undefined;
    ops.start.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => (rejectStart = reject)),
    );
    ops.stop.mockRejectedValueOnce(new Error('transport stop failed'));
    const lifecycle = new TuiChannelLifecycleCoordinator(ops, 100);

    const start = lifecycle.start();
    const stop = lifecycle.stop();
    rejectStart?.(new Error('transport start failed'));
    await expect(start).rejects.toThrow('transport start failed');
    const failure = await stop.catch((error: Error) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      expect.objectContaining({ message: 'transport start failed' }),
      expect.objectContaining({ message: 'transport stop failed' }),
    ]);

    await lifecycle.stop();
    expect(ops.stop).toHaveBeenCalledTimes(2);
  });

  it('shares session shutdown while failed transport cleanup remains retryable', async () => {
    const ops = operations();
    ops.stop.mockRejectedValueOnce(new Error('transport stop failed'));
    const lifecycle = new TuiChannelLifecycleCoordinator(ops, 100);

    await expect(lifecycle.stop()).rejects.toThrow('transport stop failed');
    expect(ops.shutdownSession).toHaveBeenCalledTimes(1);

    await lifecycle.stop();
    expect(ops.stop).toHaveBeenCalledTimes(2);
    expect(ops.shutdownSession).toHaveBeenCalledTimes(1);
  });

  it('refuses to restart after a failed teardown', async () => {
    const ops = operations();
    ops.stop.mockRejectedValueOnce(new Error('transport stop failed'));
    const lifecycle = new TuiChannelLifecycleCoordinator(ops, 100);

    await lifecycle.start();
    await expect(lifecycle.stop()).rejects.toThrow('transport stop failed');
    await expect(lifecycle.start()).rejects.toThrow(
      'Cannot start a channel after teardown has begun.',
    );

    expect(ops.start).toHaveBeenCalledTimes(1);
  });

  it('refuses to start after graceful shutdown has begun', async () => {
    const ops = operations();
    const lifecycle = new TuiChannelLifecycleCoordinator(ops, 100);

    await lifecycle.shutdown();
    await expect(lifecycle.start()).rejects.toThrow(
      'Cannot start a channel after teardown has begun.',
    );

    expect(ops.start).not.toHaveBeenCalled();
  });

  it('serializes graceful shutdown after start and shares its completion', async () => {
    const ops = operations();
    let releaseStart: (() => void) | undefined;
    let releaseShutdown: (() => void) | undefined;
    ops.start.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseStart = resolve)),
    );
    ops.shutdownSession.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseShutdown = resolve)),
    );
    const lifecycle = new TuiChannelLifecycleCoordinator(ops, 100);

    const start = lifecycle.start();
    const firstShutdown = lifecycle.shutdown();
    const secondShutdown = lifecycle.shutdown();
    await Promise.resolve();
    expect(ops.shutdownSession).not.toHaveBeenCalled();

    releaseStart?.();
    await start;
    await Promise.resolve();
    expect(ops.shutdownSession).toHaveBeenCalledTimes(1);

    let secondSettled = false;
    void secondShutdown.then(() => (secondSettled = true));
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    releaseShutdown?.();
    await Promise.all([firstShutdown, secondShutdown]);
  });

  it('does not finish stop before an in-flight graceful shutdown', async () => {
    const ops = operations();
    let releaseShutdown: (() => void) | undefined;
    ops.shutdownSession.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseShutdown = resolve)),
    );
    const lifecycle = new TuiChannelLifecycleCoordinator(ops, 100);
    await lifecycle.start();

    const shutdown = lifecycle.shutdown();
    let stopSettled = false;
    const stop = lifecycle.stop().then(() => (stopSettled = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(stopSettled).toBe(false);

    releaseShutdown?.();
    await Promise.all([shutdown, stop]);
  });

  it('does not finish graceful shutdown before an in-flight stop', async () => {
    const ops = operations();
    let releaseStop: (() => void) | undefined;
    ops.stop.mockImplementationOnce(() => new Promise<void>((resolve) => (releaseStop = resolve)));
    const lifecycle = new TuiChannelLifecycleCoordinator(ops, 100);
    await lifecycle.start();

    const stop = lifecycle.stop();
    await Promise.resolve();
    const shutdown = lifecycle.shutdown();
    let shutdownSettled = false;
    void shutdown.then(() => (shutdownSettled = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(shutdownSettled).toBe(false);
    expect(ops.shutdownSession).not.toHaveBeenCalled();

    releaseStop?.();
    await Promise.all([stop, shutdown]);
    expect(ops.shutdownSession).toHaveBeenCalledTimes(1);
  });
});
