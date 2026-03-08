import { describe, expect, it } from 'vitest';
import {
    FakeClockPort,
    InMemoryLeasePort,
    InMemoryQueuePort,
    InMemoryStoragePort,
    type IQueueMessage,
    type ITaskRun
} from '@robota-sdk/dag-core';
import { DlqReinjectService } from '../services/dlq-reinject-service.js';

function createDeadLetterMessage(): IQueueMessage {
    return {
        messageId: 'task-run-1:dlq:1',
        dagRunId: 'dag-run-1',
        taskRunId: 'task-run-1',
        nodeId: 'entry',
        attempt: 3,
        executionPath: [
            'dagId:dag-1',
            'dagRunId:dag-run-1',
            'nodeId:entry',
            'taskRunId:task-run-1',
            'attempt:3'
        ],
        payload: {
            dlqReasonCode: 'DAG_TASK_EXECUTION_HARD_FAIL',
            dlqReasonMessage: 'Hard failure'
        },
        createdAt: '2026-02-14T03:00:00.000Z'
    };
}

function createFailedTaskRun(): ITaskRun {
    return {
        taskRunId: 'task-run-1',
        dagRunId: 'dag-run-1',
        nodeId: 'entry',
        status: 'failed',
        attempt: 3
    };
}

describe('DlqReinjectService', () => {
    it('reinjects one dead letter message into main queue', async () => {
        const storage = new InMemoryStoragePort();
        const deadLetterQueue = new InMemoryQueuePort();
        const mainQueue = new InMemoryQueuePort();
        const lease = new InMemoryLeasePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 8, 0, 0));
        const service = new DlqReinjectService(storage, deadLetterQueue, mainQueue, lease, clock);

        await storage.createTaskRun(createFailedTaskRun());
        await deadLetterQueue.enqueue(createDeadLetterMessage());
        const reinjected = await service.reinjectOnce('dlq-worker-1', 10_000);

        expect(reinjected.ok).toBe(true);
        if (!reinjected.ok) {
            return;
        }
        expect(reinjected.value.reinjected).toBe(true);
        expect(reinjected.value.taskRunId).toBe('task-run-1');

        const message = await mainQueue.dequeue('main-worker-1', 1_000);
        expect(message?.attempt).toBe(4);
        expect(message?.executionPath.includes('attempt:4')).toBe(true);

        const updatedTaskRun = await storage.getTaskRun('task-run-1');
        expect(updatedTaskRun?.status).toBe('queued');
        expect(updatedTaskRun?.attempt).toBe(4);
    });

    it('skips reinject when lease is held by another worker', async () => {
        const storage = new InMemoryStoragePort();
        const deadLetterQueue = new InMemoryQueuePort();
        const mainQueue = new InMemoryQueuePort();
        const lease = new InMemoryLeasePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 8, 0, 0));
        const service = new DlqReinjectService(storage, deadLetterQueue, mainQueue, lease, clock);

        await storage.createTaskRun(createFailedTaskRun());
        await deadLetterQueue.enqueue(createDeadLetterMessage());
        await lease.acquire('taskRun:task-run-1', 'other-worker', 60_000);

        const result = await service.reinjectOnce('dlq-worker-1', 10_000);

        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.value.reinjected).toBe(false);

        const taskRun = await storage.getTaskRun('task-run-1');
        expect(taskRun?.status).toBe('failed');
    });
});
