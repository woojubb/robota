import { describe, expect, it } from 'vitest';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import {
    FakeClockPort,
    InMemoryLeasePort,
    InMemoryQueuePort,
    InMemoryStoragePort,
    MockTaskExecutorPort
} from '@robota-sdk/dag-adapters-memory';
import { WorkerLoopService } from '@robota-sdk/dag-worker';
import { RunOrchestratorService } from '@robota-sdk/dag-runtime';
import { SchedulerTriggerService } from '../services/scheduler-trigger-service.js';

function createPublishedDefinition(dagId: string): IDagDefinition {
    return {
        dagId,
        version: 1,
        status: 'published',
        nodes: [
            {
                nodeId: 'entry',
                nodeType: 'input',
                dependsOn: [],
                config: {},
                inputs: [],
                outputs: []
            }
        ],
        edges: []
    };
}

describe('Scheduler integration E2E', () => {
    it('runs catchup schedule and finalizes dag runs via worker loop', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const lease = new InMemoryLeasePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 9, 0, 0));
        const executor = new MockTaskExecutorPort(async () => ({
            ok: true,
            output: { done: true }
        }));

        await storage.saveDefinition(createPublishedDefinition('dag-scheduler-integration'));

        const scheduler = new SchedulerTriggerService(new RunOrchestratorService(storage, queue, clock));
        const worker = new WorkerLoopService(
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
                deadLetterEnabled: false,
                maxAttempts: 1,
                defaultTimeoutMs: 100
            }
        );

        const catchup = await scheduler.triggerCatchup({
            dagId: 'dag-scheduler-integration',
            rangeStartLogicalDate: '2026-02-14T09:00:00.000Z',
            rangeEndLogicalDate: '2026-02-14T10:00:00.000Z',
            slotIntervalMs: 60 * 60 * 1000,
            maxSlots: 2,
            input: {}
        });
        expect(catchup.ok).toBe(true);
        if (!catchup.ok) {
            return;
        }
        expect(catchup.value.startedRuns).toHaveLength(2);

        const firstProcess = await worker.processOnce();
        expect(firstProcess.ok).toBe(true);
        const secondProcess = await worker.processOnce();
        expect(secondProcess.ok).toBe(true);

        const firstRunId = catchup.value.startedRuns[0]?.dagRunId;
        const secondRunId = catchup.value.startedRuns[1]?.dagRunId;
        expect(firstRunId).toBeDefined();
        expect(secondRunId).toBeDefined();

        const firstRun = await storage.getDagRun(firstRunId ?? '');
        const secondRun = await storage.getDagRun(secondRunId ?? '');
        expect(firstRun?.status).toBe('success');
        expect(secondRun?.status).toBe('success');
    });
});
