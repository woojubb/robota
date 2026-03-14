import { describe, expect, it } from 'vitest';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import {
    FakeClockPort,
    InMemoryLeasePort,
    InMemoryQueuePort,
    InMemoryStoragePort,
    MockTaskExecutorPort
} from '@robota-sdk/dag-adapters-local';
import { createDagExecutionComposition } from '../composition/create-dag-execution-composition.js';

function createPublishedDefinition(): IDagDefinition {
    return {
        dagId: 'dag-1',
        version: 1,
        status: 'published',
        nodes: [
            {
                nodeId: 'entry',
                nodeType: 'task',
                dependsOn: [],
                config: {},
                inputs: [],
                outputs: []
            }
        ],
        edges: []
    };
}

describe('createDagExecutionComposition', () => {
    it('uses fail-fast as worker default policy', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const lease = new InMemoryLeasePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
        const executor = new MockTaskExecutorPort(async () => ({
            ok: false,
            error: {
                code: 'DAG_TASK_EXECUTION_FAILED',
                category: 'task_execution',
                message: 'Transient failure',
                retryable: true
            }
        }));

        await storage.saveDefinition(createPublishedDefinition());

        const composition = createDagExecutionComposition(
            { storage, queue, lease, executor, clock },
            {
                worker: {
                    workerId: 'worker-1',
                    leaseDurationMs: 30_000,
                    visibilityTimeoutMs: 30_000,
                    maxAttempts: 3,
                    defaultTimeoutMs: 100
                }
            }
        );

        const started = await composition.runOrchestrator.startRun({
            dagId: 'dag-1',
            trigger: 'manual',
            input: {}
        });
        expect(started.ok).toBe(true);
        if (!started.ok) {
            return;
        }

        const processed = await composition.workerLoop.processOnce();
        expect(processed.ok).toBe(true);
        if (!processed.ok) {
            return;
        }
        expect(processed.value.retried).toBe(false);

        const taskRunId = started.value.taskRunIds[0];
        const taskRun = await storage.getTaskRun(taskRunId);
        expect(taskRun?.status).toBe('failed');
        expect(taskRun?.attempt).toBe(1);
    });

    it('retries only when policy opt-in is explicitly enabled', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const lease = new InMemoryLeasePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
        const executor = new MockTaskExecutorPort(async () => ({
            ok: false,
            error: {
                code: 'DAG_TASK_EXECUTION_FAILED',
                category: 'task_execution',
                message: 'Transient failure',
                retryable: true
            }
        }));

        await storage.saveDefinition(createPublishedDefinition());

        const composition = createDagExecutionComposition(
            { storage, queue, lease, executor, clock },
            {
                worker: {
                    workerId: 'worker-1',
                    leaseDurationMs: 30_000,
                    visibilityTimeoutMs: 30_000,
                    maxAttempts: 3,
                    defaultTimeoutMs: 100,
                    retryEnabled: true
                }
            }
        );

        const started = await composition.runOrchestrator.startRun({
            dagId: 'dag-1',
            trigger: 'manual',
            input: {}
        });
        expect(started.ok).toBe(true);
        if (!started.ok) {
            return;
        }

        const processed = await composition.workerLoop.processOnce();
        expect(processed.ok).toBe(true);
        if (!processed.ok) {
            return;
        }
        expect(processed.value.retried).toBe(true);

        const taskRunId = started.value.taskRunIds[0];
        const taskRun = await storage.getTaskRun(taskRunId);
        expect(taskRun?.status).toBe('queued');
        expect(taskRun?.attempt).toBe(2);
    });
});
