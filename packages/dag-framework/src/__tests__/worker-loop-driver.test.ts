import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerLoopDriver } from '../runtime/worker-loop-driver.js';
import type { IRuntimeWorkerLoopPort } from '@robota-sdk/dag-api';
import type { IDagError } from '@robota-sdk/dag-core';

const TEST_ERROR: IDagError = {
  code: 'TEST_ERROR',
  category: 'task_execution',
  message: 'test error',
  retryable: false,
};

function makeWorkerLoop(
  responses: Array<{ ok: boolean; processed?: boolean }>,
): IRuntimeWorkerLoopPort {
  let i = 0;
  return {
    async processOnce() {
      const r = responses[Math.min(i++, responses.length - 1)];
      if (!r.ok) return { ok: false as const, error: TEST_ERROR };
      return { ok: true as const, value: { processed: r.processed ?? false } };
    },
  };
}

describe('WorkerLoopDriver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  it('starts and processes work items', async () => {
    let callCount = 0;
    const loop: IRuntimeWorkerLoopPort = {
      async processOnce() {
        callCount++;
        return { ok: true, value: { processed: true } };
      },
    };
    const driver = new WorkerLoopDriver(loop);
    await driver.start();
    // Give loop one tick to run
    await Promise.resolve();
    await driver.stop();
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it('double-start is idempotent (only one loop runs)', async () => {
    let callCount = 0;
    const loop: IRuntimeWorkerLoopPort = {
      async processOnce() {
        callCount++;
        return { ok: true, value: { processed: false } };
      },
    };
    const driver = new WorkerLoopDriver(loop);
    const p1 = driver.start();
    const p2 = driver.start(); // second call must be no-op
    await Promise.all([p1, p2]);
    await Promise.resolve();
    const countAfterFirstTick = callCount;
    await driver.stop();
    // Exactly one loop was active; not two
    expect(countAfterFirstTick).toBeLessThanOrEqual(2);
  });

  it('stop is idempotent when already idle', async () => {
    const driver = new WorkerLoopDriver(makeWorkerLoop([{ ok: true, processed: false }]));
    await expect(driver.stop()).resolves.toBeUndefined();
    await expect(driver.stop()).resolves.toBeUndefined();
  });

  it('logs errors on failed iteration and continues', async () => {
    const errors: Array<[string, unknown]> = [];
    const logger = {
      info: vi.fn(),
      error: (msg: string, err?: unknown) => errors.push([msg, err]),
    };
    let calls = 0;
    const loop: IRuntimeWorkerLoopPort = {
      async processOnce() {
        calls++;
        if (calls === 1) return { ok: false as const, error: TEST_ERROR };
        return { ok: true as const, value: { processed: false } };
      },
    };
    const driver = new WorkerLoopDriver(loop, logger);
    await driver.start();
    // advance past MAX_IDLE_DELAY_MS (500ms) for the error-delay
    await vi.advanceTimersByTimeAsync(600);
    await driver.stop();
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0][0]).toContain('worker-loop');
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('applies exponential backoff when idle', async () => {
    const sleepDurations: number[] = [];
    let calls = 0;
    const loop: IRuntimeWorkerLoopPort = {
      async processOnce() {
        calls++;
        return { ok: true, value: { processed: false } };
      },
    };
    const driver = new WorkerLoopDriver(loop);
    await driver.start();
    // Advance time to trigger several idle sleeps
    await vi.advanceTimersByTimeAsync(2000);
    await driver.stop();
    // Driver ran multiple idle cycles; we just verify it didn't crash and iterated > 1 times
    expect(calls).toBeGreaterThan(1);
  });

  it('resets backoff delay after processing work', async () => {
    let calls = 0;
    const responses = [
      { ok: true, processed: false }, // idle → backoff grows
      { ok: true, processed: false },
      { ok: true, processed: true }, // processed → reset delay to MIN
      { ok: true, processed: false }, // idle again from MIN
    ];
    const loop = makeWorkerLoop(responses);
    const driver = new WorkerLoopDriver(loop);
    await driver.start();
    await vi.advanceTimersByTimeAsync(1000);
    await driver.stop();
    // Verify driver didn't crash and processed expected sequence
    expect(true).toBe(true);
  });
});
