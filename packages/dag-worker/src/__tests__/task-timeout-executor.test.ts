import { describe, expect, it, vi } from 'vitest';
import type { ITaskExecutorPort, ITaskExecutionInput } from '@robota-sdk/dag-core';
import { executeWithTimeout } from '../services/task-timeout-executor.js';

const TASK_INPUT: ITaskExecutionInput = {
  executionRoot: '/test/execution-root',
  dagId: 'dag-1',
  nodeId: 'entry',
  input: {},
  dagRunId: 'dag-run-1',
  taskRunId: 'task-run-1',
  attempt: 1,
  executionPath: ['dagId:dag-1', 'dagRunId:dag-run-1', 'nodeId:entry', 'attempt:1'],
};

describe('executeWithTimeout', () => {
  it('aborts the active attempt before returning timeout and discards a late success', async () => {
    vi.useFakeTimers();
    try {
      let activeSignal: AbortSignal | undefined;
      let finish: ((result: { ok: true; output: { late: boolean } }) => void) | undefined;
      const aborted = vi.fn();
      const executor: ITaskExecutorPort = {
        execute: (input) => {
          activeSignal = input.signal;
          activeSignal?.addEventListener('abort', aborted, { once: true });
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
      };
      const pending = executeWithTimeout(executor, TASK_INPUT, 10, 'task-run-1');
      await vi.advanceTimersByTimeAsync(10);
      const result = await pending;
      expect(activeSignal?.aborted).toBe(true);
      expect(aborted).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ ok: false, error: { code: 'DAG_TASK_EXECUTION_TIMEOUT' } });
      finish?.({ ok: true, output: { late: true } });
      await Promise.resolve();
      expect(await pending).toBe(result);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects pre-aborted input without entering the executor', async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = vi.fn();
    expect(
      await executeWithTimeout(
        { execute },
        { ...TASK_INPUT, signal: controller.signal },
        10,
        'task-run-1',
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'DAG_TASK_EXECUTION_CANCELLED', retryable: false },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('forwards upstream abort to the attempt and detaches the listener after settlement', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    let attemptSignal: AbortSignal | undefined;
    const pending = executeWithTimeout(
      {
        execute: async (input) => {
          attemptSignal = input.signal;
          return new Promise(() => undefined);
        },
      },
      { ...TASK_INPUT, signal: controller.signal },
      5000,
      'task-run-1',
    );
    controller.abort();
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: 'DAG_TASK_EXECUTION_CANCELLED' },
    });
    expect(attemptSignal?.aborted).toBe(true);
    expect(remove).toHaveBeenCalledOnce();
  });

  it('cleans up its timeout when an executor throws synchronously', async () => {
    vi.useFakeTimers();
    try {
      const execute = (): never => {
        throw new Error('synchronous failure');
      };
      expect(await executeWithTimeout({ execute }, TASK_INPUT, 10, 'task-run-1')).toMatchObject({
        ok: false,
        error: { code: 'DAG_TASK_EXECUTION_EXCEPTION' },
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns executor result when execution completes before timeout', async () => {
    const executor: ITaskExecutorPort = {
      execute: vi.fn().mockResolvedValue({ ok: true, output: { done: true } }),
    };

    const result = await executeWithTimeout(executor, TASK_INPUT, 5000, 'task-run-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toEqual({ done: true });
    }
  });

  it('returns timeout error when execution exceeds timeout', async () => {
    const executor: ITaskExecutorPort = {
      execute: vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, output: {} }), 5000)),
        ),
    };

    const result = await executeWithTimeout(executor, TASK_INPUT, 10, 'task-run-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_TIMEOUT');
      expect(result.error.message).toContain('10ms');
    }
  });

  it('returns exception error when executor throws', async () => {
    const executor: ITaskExecutorPort = {
      execute: vi.fn().mockRejectedValue(new Error('Connection lost')),
    };

    const result = await executeWithTimeout(executor, TASK_INPUT, 5000, 'task-run-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_EXCEPTION');
      expect(result.error.context?.errorMessage).toBe('Connection lost');
    }
  });

  it('returns generic message when executor throws non-Error', async () => {
    const executor: ITaskExecutorPort = {
      execute: vi.fn().mockRejectedValue('string error'),
    };

    const result = await executeWithTimeout(executor, TASK_INPUT, 5000, 'task-run-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_EXCEPTION');
      expect(result.error.context?.errorMessage).toBe('Unknown error');
    }
  });

  it('returns executor failure result (not timeout) when exec fails before timeout', async () => {
    const executor: ITaskExecutorPort = {
      execute: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'DAG_TASK_EXECUTION_FAILED',
          category: 'task_execution',
          message: 'Logic error',
          retryable: false,
        },
      }),
    };

    const result = await executeWithTimeout(executor, TASK_INPUT, 5000, 'task-run-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_TASK_EXECUTION_FAILED');
    }
  });
});

it('keeps timeout as winner but waits for the isolated executor stop/join before releasing the attempt', async () => {
  vi.useFakeTimers();
  try {
    let release!: () => void;
    const joined = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stopAndWait = vi.fn(() => joined);
    let late!: (result: { ok: true; output: { late: boolean } }) => void;
    const executor = {
      execute: () =>
        new Promise<{ ok: true; output: { late: boolean } }>((resolve) => {
          late = resolve;
        }),
      stopAndWait,
    };
    let settled = false;
    const pending = executeWithTimeout(executor, TASK_INPUT, 10, 'task-run-1').then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(stopAndWait).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    late({ ok: true, output: { late: true } });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: 'DAG_TASK_EXECUTION_TIMEOUT' },
    });
  } finally {
    vi.useRealTimers();
  }
});

it('preserves the timeout winner and disables retry if isolated shutdown fails', async () => {
  const result = await executeWithTimeout(
    {
      execute: () => new Promise<never>(() => {}),
      stopAndWait: async () => {
        throw new Error('join failed');
      },
    },
    TASK_INPUT,
    1,
    'task-run-1',
  );
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: 'DAG_TASK_EXECUTION_TIMEOUT',
      retryable: false,
      context: { isolationStopError: 'join failed' },
    },
  });
});
