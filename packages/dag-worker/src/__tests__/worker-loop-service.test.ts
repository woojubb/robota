import { describe, expect, it } from 'vitest';
import {
    FakeClockPort,
    InMemoryLeasePort,
    InMemoryQueuePort,
    InMemoryStoragePort,
    MockTaskExecutorPort,
    type IDagDefinition,
    type IDagRun,
    type IQueueMessage,
    type ITaskRun
} from '@robota-sdk/dag-core';
import { WorkerLoopService } from '../services/worker-loop-service.js';

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

describe('WorkerLoopService', () => {
    function createService(
        executor: MockTaskExecutorPort,
        storage: InMemoryStoragePort,
        queue: InMemoryQueuePort,
        lease: InMemoryLeasePort,
        clock: FakeClockPort,
        retryEnabled = false
    ): WorkerLoopService {
        return new WorkerLoopService(
            storage,
            queue,
            lease,
            executor,
            clock,
            {
                workerId: 'worker-1',
                leaseDurationMs: 30_000,
                visibilityTimeoutMs: 30_000,
                retryEnabled,
                maxAttempts: 3,
                defaultTimeoutMs: 50
            }
        );
    }

    it('marks task success and acknowledges message', async () => {
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
            ok: true,
            output: { done: true }
        }));

        const service = createService(executor, storage, queue, lease, clock);
        const result = await service.processOnce();

        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.value.retried).toBe(false);

        const updated = await storage.getTaskRun(taskRun.taskRunId);
        expect(updated?.status).toBe('success');
        const run = await storage.getDagRun(dagRun.dagRunId);
        expect(run?.status).toBe('success');

        const next = await queue.dequeue('worker-2', 1_000);
        expect(next).toBeUndefined();
    });

    it('keeps failed status when retry policy is disabled even with retryable error', async () => {
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

        const service = createService(executor, storage, queue, lease, clock);
        const result = await service.processOnce();

        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.value.retried).toBe(false);

        const updated = await storage.getTaskRun(taskRun.taskRunId);
        expect(updated?.status).toBe('failed');
        expect(updated?.attempt).toBe(1);

        const retriedMessage = await queue.dequeue('worker-2', 1_000);
        expect(retriedMessage).toBeUndefined();
    });

    it('re-enqueues task when retry policy is enabled and error is retryable', async () => {
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

        const service = createService(executor, storage, queue, lease, clock, true);
        const result = await service.processOnce();

        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.value.retried).toBe(true);

        const updated = await storage.getTaskRun(taskRun.taskRunId);
        expect(updated?.status).toBe('queued');
        expect(updated?.attempt).toBe(2);

        const retriedMessage = await queue.dequeue('worker-2', 1_000);
        expect(retriedMessage?.attempt).toBe(2);
    });

    it('keeps failed status when error is non-retryable', async () => {
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
                code: 'DAG_TASK_EXECUTION_HARD_FAIL',
                category: 'task_execution',
                message: 'Hard failure',
                retryable: false
            }
        }));

        const service = createService(executor, storage, queue, lease, clock);
        const result = await service.processOnce();

        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.value.retried).toBe(false);

        const updated = await storage.getTaskRun(taskRun.taskRunId);
        expect(updated?.status).toBe('failed');
        expect(updated?.attempt).toBe(1);

        const run = await storage.getDagRun(dagRun.dagRunId);
        expect(run?.status).toBe('failed');
    });

    it('transitions to terminal failure after retry attempts are exhausted', async () => {
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

        const service = new WorkerLoopService(
            storage,
            queue,
            lease,
            executor,
            clock,
            {
                workerId: 'worker-1',
                leaseDurationMs: 30_000,
                visibilityTimeoutMs: 30_000,
                retryEnabled: true,
                maxAttempts: 2,
                defaultTimeoutMs: 50
            }
        );

        const first = await service.processOnce();
        expect(first.ok).toBe(true);
        if (!first.ok) {
            return;
        }
        expect(first.value.retried).toBe(true);

        const second = await service.processOnce();
        expect(second.ok).toBe(true);
        if (!second.ok) {
            return;
        }
        expect(second.value.retried).toBe(false);

        const updated = await storage.getTaskRun(taskRun.taskRunId);
        expect(updated?.status).toBe('failed');
        expect(updated?.attempt).toBe(2);

        const run = await storage.getDagRun(dagRun.dagRunId);
        expect(run?.status).toBe('failed');
    });

    it('reassigns processing after lease becomes available', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const lease = new InMemoryLeasePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
        const { dagRun, taskRun, message } = createQueuedTaskFixture();

        await storage.saveDefinition(createDefinitionForRun(dagRun));
        await storage.createDagRun(dagRun);
        await storage.createTaskRun(taskRun);
        await queue.enqueue(message);

        await lease.acquire(`taskRun:${taskRun.taskRunId}`, 'worker-lock', 1);

        const executor = new MockTaskExecutorPort(async () => ({
            ok: true,
            output: { done: true }
        }));

        const worker = new WorkerLoopService(
            storage,
            queue,
            lease,
            executor,
            clock,
            {
                workerId: 'worker-2',
                leaseDurationMs: 30_000,
                visibilityTimeoutMs: 30_000,
                retryEnabled: false,
                maxAttempts: 1,
                defaultTimeoutMs: 50
            }
        );

        const firstAttempt = await worker.processOnce();
        expect(firstAttempt.ok).toBe(false);
        if (firstAttempt.ok) {
            return;
        }
        expect(firstAttempt.error.code).toBe('DAG_LEASE_CONTRACT_VIOLATION');

        await lease.release(`taskRun:${taskRun.taskRunId}`, 'worker-lock');

        const secondAttempt = await worker.processOnce();
        expect(secondAttempt.ok).toBe(true);
        if (!secondAttempt.ok) {
            return;
        }
        expect(secondAttempt.value.processed).toBe(true);

        const updated = await storage.getTaskRun(taskRun.taskRunId);
        expect(updated?.status).toBe('success');
    });

    it('sends failed message to dead letter queue when enabled', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const deadLetterQueue = new InMemoryQueuePort();
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
                code: 'DAG_TASK_EXECUTION_HARD_FAIL',
                category: 'task_execution',
                message: 'Hard failure',
                retryable: false
            }
        }));

        const service = new WorkerLoopService(
            storage,
            queue,
            lease,
            executor,
            clock,
            {
                workerId: 'worker-1',
                leaseDurationMs: 30_000,
                visibilityTimeoutMs: 30_000,
                retryEnabled: false,
                deadLetterEnabled: true,
                deadLetterQueue,
                maxAttempts: 1,
                defaultTimeoutMs: 50
            }
        );

        const result = await service.processOnce();
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }

        const deadLetterMessage = await deadLetterQueue.dequeue('dlq-reader', 1_000);
        expect(deadLetterMessage?.taskRunId).toBe(taskRun.taskRunId);
        expect(deadLetterMessage?.payload.dlqReasonCode).toBe('DAG_TASK_EXECUTION_HARD_FAIL');
    });

    it('dispatches downstream ready node after upstream success', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const lease = new InMemoryLeasePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
        const { dagRun, taskRun, message } = createQueuedTaskFixture();

        await storage.saveDefinition({
            dagId: dagRun.dagId,
            version: dagRun.version,
            status: 'published',
            nodes: [
                {
                    nodeId: 'entry',
                    nodeType: 'input',
                    dependsOn: [],
                    config: {}
                },
                {
                    nodeId: 'next',
                    nodeType: 'processor',
                    dependsOn: ['entry'],
                    config: {}
                }
            ],
            edges: [{ from: 'entry', to: 'next' }]
        });
        await storage.createDagRun(dagRun);
        await storage.createTaskRun(taskRun);
        await queue.enqueue(message);

        const executor = new MockTaskExecutorPort(async () => ({
            ok: true,
            output: { nextInput: 'ok' }
        }));
        const service = createService(executor, storage, queue, lease, clock);

        const first = await service.processOnce();
        expect(first.ok).toBe(true);
        if (!first.ok) {
            return;
        }

        const nextTaskRun = (await storage.listTaskRunsByDagRunId(dagRun.dagRunId))
            .find((candidate) => candidate.nodeId === 'next');
        expect(nextTaskRun?.status).toBe('queued');

        const firstRunState = await storage.getDagRun(dagRun.dagRunId);
        expect(firstRunState?.status).toBe('running');

        const second = await service.processOnce();
        expect(second.ok).toBe(true);
        if (!second.ok) {
            return;
        }

        const finalRun = await storage.getDagRun(dagRun.dagRunId);
        expect(finalRun?.status).toBe('success');
    });
});
