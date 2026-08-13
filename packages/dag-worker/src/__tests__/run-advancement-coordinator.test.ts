import { describe, expect, it, vi } from 'vitest';

import {
  RunAdvancementCoordinator,
  RunAdvancementStoppedError,
} from '../services/run-advancement-coordinator.js';

import type { IDagError, IDagRun, ITaskRun, TResult } from '@robota-sdk/dag-core';
import type { IRunAdvancementSnapshot } from '../services/run-advancement-coordinator.js';
import type { IWorkerLoopResult } from '../services/worker-loop-service.js';

function snapshot(status: IDagRun['status']): IRunAdvancementSnapshot {
  return {
    dagRun: {
      dagRunId: 'run-1',
      dagId: 'dag-1',
      version: 1,
      runKey: 'run-key-1',
      logicalDate: '2026-01-01T00:00:00.000Z',
      status,
      trigger: 'manual',
    },
    taskRuns: [] as ITaskRun[],
  };
}

function failure(code: string): TResult<never, IDagError> {
  return {
    ok: false,
    error: { code, category: 'dispatch', message: code, retryable: false },
  };
}

describe('RunAdvancementCoordinator', () => {
  it('returns an already-terminal run without starting a worker step', async () => {
    const processOnce = vi.fn<() => Promise<TResult<IWorkerLoopResult, IDagError>>>();
    const getRun = vi.fn().mockResolvedValue({ ok: true, value: snapshot('success') });
    const coordinator = new RunAdvancementCoordinator({ processOnce }, { getRun });

    const result = await coordinator.waitForTerminal('run-1');

    expect(result).toEqual({ ok: true, value: snapshot('success') });
    expect(processOnce).not.toHaveBeenCalled();
    await coordinator.stop();
  });

  it('shares one worker actor between continuous demand and concurrent waiters', async () => {
    let active = 0;
    let maximumActive = 0;
    let steps = 0;
    const processOnce = vi.fn(async (): Promise<TResult<IWorkerLoopResult, IDagError>> => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        steps += 1;
        return { ok: true, value: { processed: true } };
      } finally {
        active -= 1;
      }
    });
    const getRun = vi.fn(async () => ({
      ok: true as const,
      value: snapshot(steps >= 2 ? 'success' : 'running'),
    }));
    const coordinator = new RunAdvancementCoordinator({ processOnce }, { getRun });

    await coordinator.start();
    const results = await Promise.all([
      coordinator.waitForTerminal('run-1'),
      coordinator.waitForTerminal('run-1'),
      coordinator.waitForTerminal('run-1'),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(maximumActive).toBe(1);
    expect(steps).toBeGreaterThanOrEqual(2);
    await coordinator.stop();
  });

  it('aborts only the requesting waiter while another waiter reaches terminal state', async () => {
    let processed = false;
    const processOnce = vi.fn(async () => {
      processed = true;
      return { ok: true as const, value: { processed: true } };
    });
    const getRun = vi.fn(async () => ({
      ok: true as const,
      value: snapshot(processed ? 'success' : 'running'),
    }));
    const coordinator = new RunAdvancementCoordinator({ processOnce }, { getRun });
    const controller = new AbortController();

    const abandoned = coordinator.waitForTerminal('run-1', { signal: controller.signal });
    const retained = coordinator.waitForTerminal('run-1');
    controller.abort();

    const [abandonedResult, retainedResult] = await Promise.all([abandoned, retained]);
    expect(abandonedResult).toMatchObject({
      ok: false,
      error: { code: 'DAG_RUNTIME_ADVANCEMENT_WAIT_ABORTED' },
    });
    expect(retainedResult).toEqual({ ok: true, value: snapshot('success') });
    expect(processOnce).toHaveBeenCalledTimes(1);
    await coordinator.stop();
  });

  it('preserves the run-reader error for every waiter on that run', async () => {
    const expected = failure('DAG_RUNTIME_QUERY_FAILED');
    const processOnce = vi.fn<() => Promise<TResult<IWorkerLoopResult, IDagError>>>();
    const getRun = vi.fn().mockResolvedValue(expected);
    const coordinator = new RunAdvancementCoordinator({ processOnce }, { getRun });

    const [first, second] = await Promise.all([
      coordinator.waitForTerminal('run-1'),
      coordinator.waitForTerminal('run-1'),
    ]);

    expect(first).toBe(expected);
    expect(second).toBe(expected);
    expect(processOnce).not.toHaveBeenCalled();
    await coordinator.stop();
  });

  it('turns a thrown run-reader failure into a typed observer result', async () => {
    const processOnce = vi.fn<() => Promise<TResult<IWorkerLoopResult, IDagError>>>();
    const getRun = vi.fn().mockRejectedValue(new Error('reader exploded'));
    const coordinator = new RunAdvancementCoordinator({ processOnce }, { getRun });

    const result = await coordinator.waitForTerminal('run-1');

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'DAG_RUNTIME_ADVANCEMENT_QUERY_THROW', message: 'reader exploded' },
    });
    expect(processOnce).not.toHaveBeenCalled();
    await coordinator.stop();
  });

  it('settles a deadline for one observer without cancelling the run', async () => {
    let releaseStep!: () => void;
    const heldStep = new Promise<void>((resolve) => {
      releaseStep = resolve;
    });
    const processOnce = vi.fn(async () => {
      await heldStep;
      return { ok: true as const, value: { processed: true } };
    });
    const getRun = vi.fn().mockResolvedValue({ ok: true, value: snapshot('running') });
    const coordinator = new RunAdvancementCoordinator({ processOnce }, { getRun });

    const result = await coordinator.waitForTerminal('run-1', {
      deadlineEpochMs: Date.now() + 10,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'DAG_RUNTIME_ADVANCEMENT_WAIT_DEADLINE' },
    });
    releaseStep();
    await coordinator.stop();
    expect(processOnce).toHaveBeenCalledTimes(1);
  });

  it('retries a queue-wide worker error without misclassifying the observed run', async () => {
    let calls = 0;
    const processOnce = vi.fn(async (): Promise<TResult<IWorkerLoopResult, IDagError>> => {
      calls += 1;
      if (calls === 1) return failure('DAG_DISPATCH_TRANSIENT');
      return { ok: true, value: { processed: true } };
    });
    const getRun = vi.fn(async () => ({
      ok: true as const,
      value: snapshot(calls >= 2 ? 'success' : 'running'),
    }));
    const logger = { error: vi.fn() };
    const coordinator = new RunAdvancementCoordinator({ processOnce }, { getRun }, logger);

    const result = await coordinator.waitForTerminal('run-1');

    expect(result).toEqual({ ok: true, value: snapshot('success') });
    expect(calls).toBe(2);
    expect(logger.error).toHaveBeenCalledWith(
      'Worker step failed during run advancement.',
      expect.objectContaining({ code: 'DAG_DISPATCH_TRANSIENT' }),
    );
    await coordinator.stop();
  });

  it('captures a thrown worker step and resumes the same owned actor', async () => {
    let calls = 0;
    const processOnce = vi.fn(async (): Promise<TResult<IWorkerLoopResult, IDagError>> => {
      calls += 1;
      if (calls === 1) throw new Error('step exploded');
      return { ok: true, value: { processed: true } };
    });
    const getRun = vi.fn(async () => ({
      ok: true as const,
      value: snapshot(calls >= 2 ? 'success' : 'running'),
    }));
    const logger = { error: vi.fn() };
    const coordinator = new RunAdvancementCoordinator({ processOnce }, { getRun }, logger);

    const result = await coordinator.waitForTerminal('run-1');

    expect(result).toEqual({ ok: true, value: snapshot('success') });
    expect(logger.error).toHaveBeenCalledWith(
      'Worker step threw during run advancement.',
      expect.objectContaining({ message: 'step exploded' }),
    );
    await coordinator.stop();
  });

  it('closes admission, settles waiters, and drains only the in-flight step on stop', async () => {
    let releaseStep!: () => void;
    const heldStep = new Promise<void>((resolve) => {
      releaseStep = resolve;
    });
    const processOnce = vi.fn(async () => {
      await heldStep;
      return { ok: true as const, value: { processed: true } };
    });
    const getRun = vi.fn().mockResolvedValue({ ok: true, value: snapshot('running') });
    const coordinator = new RunAdvancementCoordinator({ processOnce }, { getRun });
    const waiter = coordinator.waitForTerminal('run-1');
    await vi.waitFor(() => expect(processOnce).toHaveBeenCalledTimes(1));

    let stopped = false;
    const stopping = coordinator.stop().then(() => {
      stopped = true;
    });
    const waiterResult = await waiter;
    expect(waiterResult).toMatchObject({
      ok: false,
      error: { code: 'DAG_RUNTIME_ADVANCEMENT_STOPPED' },
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    releaseStep();
    await stopping;
    await coordinator.stop();
    expect(processOnce).toHaveBeenCalledTimes(1);
    await expect(coordinator.start()).rejects.toBeInstanceOf(RunAdvancementStoppedError);
    await expect(coordinator.waitForTerminal('run-2')).resolves.toMatchObject({
      ok: false,
      error: { code: 'DAG_RUNTIME_ADVANCEMENT_STOPPED' },
    });
  });
});
