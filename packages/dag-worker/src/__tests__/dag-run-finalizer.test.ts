import { describe, expect, it, vi } from 'vitest';
import type { IDagRun, IRunProgressEventReporter } from '@robota-sdk/dag-core';
import { FakeClockPort, InMemoryStoragePort } from '@robota-sdk/dag-adapters-local';
import { finalizeDagRunIfTerminal } from '../services/dag-run-finalizer.js';

function createRunningDagRun(): IDagRun {
    return {
        dagRunId: 'dag-run-1',
        dagId: 'dag-1',
        version: 1,
        status: 'running',
        runKey: 'dag-1:run-1',
        logicalDate: '2026-02-14T03:00:00.000Z',
        trigger: 'manual',
        startedAt: '2026-02-14T03:00:00.000Z'
    };
}

describe('finalizeDagRunIfTerminal', () => {
    it('returns error when dag run not found', async () => {
        const storage = new InMemoryStoragePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));

        const result = await finalizeDagRunIfTerminal('nonexistent', storage, clock);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_DAG_RUN_NOT_FOUND');
        }
    });

    it('does not finalize when dag run is not in running status', async () => {
        const storage = new InMemoryStoragePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
        await storage.createDagRun({ ...createRunningDagRun(), status: 'success' });

        const result = await finalizeDagRunIfTerminal('dag-run-1', storage, clock);
        expect(result.ok).toBe(true);
        const run = await storage.getDagRun('dag-run-1');
        expect(run?.status).toBe('success');
    });

    it('does not finalize when pending tasks exist', async () => {
        const storage = new InMemoryStoragePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
        await storage.createDagRun(createRunningDagRun());
        await storage.createTaskRun({
            taskRunId: 'task-1',
            dagRunId: 'dag-run-1',
            nodeId: 'a',
            status: 'running',
            attempt: 1
        });

        const result = await finalizeDagRunIfTerminal('dag-run-1', storage, clock);
        expect(result.ok).toBe(true);
        const run = await storage.getDagRun('dag-run-1');
        expect(run?.status).toBe('running');
    });

    it('finalizes as success when all tasks are successful', async () => {
        const storage = new InMemoryStoragePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
        await storage.createDagRun(createRunningDagRun());
        await storage.createTaskRun({
            taskRunId: 'task-1',
            dagRunId: 'dag-run-1',
            nodeId: 'a',
            status: 'success',
            attempt: 1
        });

        const reporter: IRunProgressEventReporter = { publish: vi.fn() };
        const result = await finalizeDagRunIfTerminal('dag-run-1', storage, clock, reporter);
        expect(result.ok).toBe(true);
        const run = await storage.getDagRun('dag-run-1');
        expect(run?.status).toBe('success');
        expect(reporter.publish).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: 'execution.completed' })
        );
    });

    it('finalizes as failed when any task is failed', async () => {
        const storage = new InMemoryStoragePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
        await storage.createDagRun(createRunningDagRun());
        await storage.createTaskRun({
            taskRunId: 'task-1',
            dagRunId: 'dag-run-1',
            nodeId: 'a',
            status: 'failed',
            attempt: 1,
            errorCode: 'DAG_TASK_EXECUTION_FAILED',
            errorMessage: 'Something broke'
        });

        const reporter: IRunProgressEventReporter = { publish: vi.fn() };
        const result = await finalizeDagRunIfTerminal('dag-run-1', storage, clock, reporter);
        expect(result.ok).toBe(true);
        const run = await storage.getDagRun('dag-run-1');
        expect(run?.status).toBe('failed');
        expect(reporter.publish).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: 'execution.failed' })
        );
    });

    it('finalizes as success when tasks are upstream_failed, skipped, or cancelled (no actual failed)', async () => {
        const storage = new InMemoryStoragePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
        await storage.createDagRun(createRunningDagRun());
        await storage.createTaskRun({
            taskRunId: 'task-1',
            dagRunId: 'dag-run-1',
            nodeId: 'a',
            status: 'success',
            attempt: 1
        });
        await storage.createTaskRun({
            taskRunId: 'task-2',
            dagRunId: 'dag-run-1',
            nodeId: 'b',
            status: 'upstream_failed',
            attempt: 1
        });
        await storage.createTaskRun({
            taskRunId: 'task-3',
            dagRunId: 'dag-run-1',
            nodeId: 'c',
            status: 'cancelled',
            attempt: 1
        });

        const result = await finalizeDagRunIfTerminal('dag-run-1', storage, clock);
        expect(result.ok).toBe(true);
        const run = await storage.getDagRun('dag-run-1');
        expect(run?.status).toBe('success');
    });

    it('publishes failure event with error details from failed task', async () => {
        const storage = new InMemoryStoragePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
        await storage.createDagRun(createRunningDagRun());
        await storage.createTaskRun({
            taskRunId: 'task-1',
            dagRunId: 'dag-run-1',
            nodeId: 'a',
            status: 'failed',
            attempt: 1,
            errorCode: 'CUSTOM_ERROR',
            errorMessage: 'Custom error message'
        });

        const reporter: IRunProgressEventReporter = { publish: vi.fn() };
        await finalizeDagRunIfTerminal('dag-run-1', storage, clock, reporter);

        expect(reporter.publish).toHaveBeenCalledWith(
            expect.objectContaining({
                eventType: 'execution.failed',
                error: expect.objectContaining({
                    code: 'CUSTOM_ERROR',
                    message: 'Custom error message'
                })
            })
        );
    });

    it('publishes generic failure event when failed task has no error details', async () => {
        const storage = new InMemoryStoragePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
        await storage.createDagRun(createRunningDagRun());
        await storage.createTaskRun({
            taskRunId: 'task-1',
            dagRunId: 'dag-run-1',
            nodeId: 'a',
            status: 'failed',
            attempt: 1
        });

        const reporter: IRunProgressEventReporter = { publish: vi.fn() };
        await finalizeDagRunIfTerminal('dag-run-1', storage, clock, reporter);

        expect(reporter.publish).toHaveBeenCalledWith(
            expect.objectContaining({
                eventType: 'execution.failed',
                error: expect.objectContaining({
                    code: 'DAG_TASK_EXECUTION_FAILED'
                })
            })
        );
    });
});
