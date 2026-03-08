import { describe, expect, it } from 'vitest';
import {
    FakeClockPort,
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

describe('DlqReinjectService', () => {
    it('reinjects one dead letter message into main queue', async () => {
        const storage = new InMemoryStoragePort();
        const deadLetterQueue = new InMemoryQueuePort();
        const mainQueue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 8, 0, 0));
        const service = new DlqReinjectService(storage, deadLetterQueue, mainQueue, clock);

        const failedTaskRun: ITaskRun = {
            taskRunId: 'task-run-1',
            dagRunId: 'dag-run-1',
            nodeId: 'entry',
            status: 'failed',
            attempt: 3
        };
        await storage.createTaskRun(failedTaskRun);

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
});
