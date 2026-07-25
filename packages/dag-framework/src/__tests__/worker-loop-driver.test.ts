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

const MAX_IDLE_DELAY_MS = 500;

/** The faked `setTimeout` captured by `beforeEach`, so the spy can delegate to it. */
let fakedSetTimeout: typeof setTimeout;

/**
 * Record every idle sleep the driver schedules. Must be called AFTER `vi.useFakeTimers()`
 * so the spy wraps the faked `setTimeout` the driver will actually call.
 */
function recordSleepDurations(): number[] {
  const durations: number[] = [];
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ) => {
    durations.push(timeout ?? 0);
    return (fakedSetTimeout as (...a: unknown[]) => unknown)(handler, timeout, ...args);
  }) as unknown as typeof setTimeout);
  return durations;
}

describe('WorkerLoopDriver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakedSetTimeout = globalThis.setTimeout;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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

  it('applies exponential backoff when idle, capped at MAX_IDLE_DELAY_MS', async () => {
    const sleepDurations = recordSleepDurations();
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

    expect(calls).toBeGreaterThan(1);
    // The delay must actually DOUBLE from MIN each idle round and saturate at MAX —
    // asserting only that the loop iterated would pass with backoff removed entirely.
    expect(sleepDurations.slice(0, 5)).toEqual([50, 100, 200, 400, 500]);
    expect(Math.max(...sleepDurations)).toBe(MAX_IDLE_DELAY_MS);
  });

  it('resets backoff delay after processing work', async () => {
    const sleepDurations = recordSleepDurations();
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

    // 50, 100 while idle; the processed round sleeps not at all and resets the delay,
    // so the next idle round must sleep 50 again — not 200.
    expect(sleepDurations.slice(0, 4)).toEqual([50, 100, 50, 100]);
  });
});
