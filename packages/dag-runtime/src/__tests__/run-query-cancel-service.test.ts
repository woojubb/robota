import { describe, expect, it } from 'vitest';
import type { IDagRun, ITaskRun } from '@robota-sdk/dag-core';
import { FakeClockPort, InMemoryStoragePort } from '@robota-sdk/dag-adapters-memory';
import { RunCancelService } from '../services/run-cancel-service.js';
import { RunQueryService } from '../services/run-query-service.js';

function createRun(): IDagRun {
    return {
        dagRunId: 'run-1',
        dagId: 'dag-1',
        version: 1,
        status: 'running',
        runKey: 'dag-1:run-1',
        logicalDate: '2026-02-14T03:00:00.000Z',
        trigger: 'manual',
        startedAt: '2026-02-14T03:00:00.000Z'
    };
}

function createTaskRun(): ITaskRun {
    return {
        taskRunId: 'task-1',
        dagRunId: 'run-1',
        nodeId: 'entry',
        status: 'queued',
        attempt: 1
    };
}

describe('RunQueryService and RunCancelService', () => {
    it('queries run and task runs', async () => {
        const storage = new InMemoryStoragePort();
        await storage.createDagRun(createRun());
        await storage.createTaskRun(createTaskRun());
        const service = new RunQueryService(storage);

        const queried = await service.getRun('run-1');
        expect(queried.ok).toBe(true);
        if (!queried.ok) {
            return;
        }

        expect(queried.value.dagRun.status).toBe('running');
        expect(queried.value.taskRuns).toHaveLength(1);
        expect(queried.value.taskRuns[0]?.taskRunId).toBe('task-1');
    });

    it('cancels run from running status', async () => {
        const storage = new InMemoryStoragePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 4, 0, 0));
        await storage.createDagRun(createRun());
        const service = new RunCancelService(storage, clock);

        const cancelled = await service.cancelRun('run-1');
        expect(cancelled.ok).toBe(true);
        if (!cancelled.ok) {
            return;
        }

        const run = await storage.getDagRun('run-1');
        expect(run?.status).toBe('cancelled');
        expect(run?.endedAt).toBe('2026-02-14T04:00:00.000Z');
    });
});
