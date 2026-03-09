import { describe, expect, it, vi } from 'vitest';
import type { ITaskExecutorPort, ITaskExecutionInput } from '@robota-sdk/dag-core';
import { executeWithTimeout } from '../services/task-timeout-executor.js';

const TASK_INPUT: ITaskExecutionInput = {
    nodeId: 'entry',
    nodeType: 'input',
    config: {},
    payload: {},
    dagRunId: 'dag-run-1',
    taskRunId: 'task-run-1',
    attempt: 1,
    executionPath: ['dagId:dag-1', 'dagRunId:dag-run-1', 'nodeId:entry', 'attempt:1']
};

describe('executeWithTimeout', () => {
    it('returns executor result when execution completes before timeout', async () => {
        const executor: ITaskExecutorPort = {
            execute: vi.fn().mockResolvedValue({ ok: true, output: { done: true } })
        };

        const result = await executeWithTimeout(executor, TASK_INPUT, 5000, 'task-run-1');

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.output).toEqual({ done: true });
        }
    });

    it('returns timeout error when execution exceeds timeout', async () => {
        const executor: ITaskExecutorPort = {
            execute: vi.fn().mockImplementation(
                () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, output: {} }), 5000))
            )
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
            execute: vi.fn().mockRejectedValue(new Error('Connection lost'))
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
            execute: vi.fn().mockRejectedValue('string error')
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
                    retryable: false
                }
            })
        };

        const result = await executeWithTimeout(executor, TASK_INPUT, 5000, 'task-run-1');

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_TASK_EXECUTION_FAILED');
        }
    });
});
