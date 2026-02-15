import { describe, expect, it } from 'vitest';
import {
    FakeClockPort,
    type IDagDefinition,
    InMemoryLeasePort,
    InMemoryQueuePort,
    InMemoryStoragePort,
    MockTaskExecutorPort,
    type IDagRun,
    type IQueueMessage,
    type ITaskRun
} from '@robota-sdk/dag-core';
import { createWorkerLoopService } from '../composition/create-worker-loop-service.js';

function createQueuedTaskFixture() {
    const dagRun: IDagRun = {
        dagRunId: 'dag-run-1',
        dagId: 'dag-1',
        version: 1,
        status: 'running',
        runKey: 'dag-1:run-1',
        logicalDate: '2026-02-14T03:00:00.000Z',
        trigger: 'manual',
        startedAt: '2026-02-14T03:00:00.000Z'
    };

    const taskRun: ITaskRun = {
        taskRunId: 'task-run-1',
        dagRunId: dagRun.dagRunId,
        nodeId: 'entry',
        status: 'queued',
        attempt: 1
    };

    const message: IQueueMessage = {
        messageId: 'task-run-1:message:1',
        dagRunId: dagRun.dagRunId,
        taskRunId: taskRun.taskRunId,
        nodeId: taskRun.nodeId,
        attempt: 1,
        executionPath: [
            `dagId:${dagRun.dagId}`,
            `dagRunId:${dagRun.dagRunId}`,
            `nodeId:${taskRun.nodeId}`,
            `taskRunId:${taskRun.taskRunId}`,
            'attempt:1'
        ],
        payload: {},
        createdAt: '2026-02-14T03:00:00.000Z'
    };

    return { dagRun, taskRun, message };
}

function createDefinitionForRun(dagRun: IDagRun): IDagDefinition {
    return {
        dagId: dagRun.dagId,
        version: dagRun.version,
        status: 'published',
        nodes: [
            {
                nodeId: 'entry',
                nodeType: 'input',
                dependsOn: [],
                config: {}
            }
        ],
        edges: []
    };
}

describe('createWorkerLoopService', () => {
    it('uses fail-fast retry policy by default', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const lease = new InMemoryLeasePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
        const { dagRun, taskRun, message } = createQueuedTaskFixture();

        await storage.saveDefinition(createDefinitionForRun(dagRun));
        await storage.createDagRun(dagRun);
        await storage.createTaskRun(taskRun);
        await queue.enqueue(message);

        const executor = new MockTaskExecutorPort(async () => ({
            ok: false,
            error: {
                code: 'DAG_TASK_EXECUTION_FAILED',
                category: 'task_execution',
                message: 'Transient failure',
                retryable: true
            }
        }));

        const service = createWorkerLoopService(
            { storage, queue, lease, executor, clock },
            {
                workerId: 'worker-1',
                leaseDurationMs: 30_000,
                visibilityTimeoutMs: 30_000,
                maxAttempts: 3,
                defaultTimeoutMs: 50
            }
        );

        const result = await service.processOnce();
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }

        const updated = await storage.getTaskRun(taskRun.taskRunId);
        expect(updated?.status).toBe('failed');
        expect(updated?.attempt).toBe(1);

        const retriedMessage = await queue.dequeue('worker-2', 1_000);
        expect(retriedMessage).toBeUndefined();
    });
});
