import { describe, expect, it } from 'vitest';
import {
    FakeClockPort,
    InMemoryQueuePort,
    InMemoryStoragePort,
    type IDagDefinition
} from '@robota-sdk/dag-core';
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

describe('SchedulerTriggerService', () => {
    it('triggers one scheduled run with explicit logicalDate', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));
        await storage.saveDefinition(createPublishedDefinition('dag-scheduler-one'));

        const service = new SchedulerTriggerService(storage, queue, clock);
        const started = await service.triggerScheduledRun({
            dagId: 'dag-scheduler-one',
            logicalDate: '2026-02-14T07:00:00.000Z',
            input: {}
        });

        expect(started.ok).toBe(true);
        if (!started.ok) {
            return;
        }

        const run = await storage.getDagRun(started.value.dagRunId);
        expect(run?.trigger).toBe('scheduled');
        expect(run?.status).toBe('running');
    });

    it('triggers batch and preserves idempotency by runKey', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));
        await storage.saveDefinition(createPublishedDefinition('dag-scheduler-batch'));

        const service = new SchedulerTriggerService(storage, queue, clock);
        const firstBatch = await service.triggerScheduledBatch({
            items: [
                {
                    dagId: 'dag-scheduler-batch',
                    logicalDate: '2026-02-14T07:00:00.000Z',
                    input: {}
                }
            ]
        });
        expect(firstBatch.ok).toBe(true);
        if (!firstBatch.ok) {
            return;
        }

        const secondBatch = await service.triggerScheduledBatch({
            items: [
                {
                    dagId: 'dag-scheduler-batch',
                    logicalDate: '2026-02-14T07:00:00.000Z',
                    input: {}
                }
            ]
        });
        expect(secondBatch.ok).toBe(true);
        if (!secondBatch.ok) {
            return;
        }

        expect(secondBatch.value.startedRuns[0]?.dagRunId).toBe(firstBatch.value.startedRuns[0]?.dagRunId);
    });

    it('triggers catchup range within maxSlots limit', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));
        await storage.saveDefinition(createPublishedDefinition('dag-scheduler-catchup'));

        const service = new SchedulerTriggerService(storage, queue, clock);
        const catchup = await service.triggerCatchup({
            dagId: 'dag-scheduler-catchup',
            rangeStartLogicalDate: '2026-02-14T07:00:00.000Z',
            rangeEndLogicalDate: '2026-02-14T09:00:00.000Z',
            slotIntervalMs: 60 * 60 * 1000,
            maxSlots: 3,
            input: {}
        });

        expect(catchup.ok).toBe(true);
        if (!catchup.ok) {
            return;
        }
        expect(catchup.value.requestedSlotCount).toBe(3);
        expect(catchup.value.startedRuns).toHaveLength(3);
    });

    it('rejects catchup range when requested slots exceed maxSlots', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));
        await storage.saveDefinition(createPublishedDefinition('dag-scheduler-catchup-limit'));

        const service = new SchedulerTriggerService(storage, queue, clock);
        const catchup = await service.triggerCatchup({
            dagId: 'dag-scheduler-catchup-limit',
            rangeStartLogicalDate: '2026-02-14T07:00:00.000Z',
            rangeEndLogicalDate: '2026-02-14T10:00:00.000Z',
            slotIntervalMs: 60 * 60 * 1000,
            maxSlots: 3,
            input: {}
        });

        expect(catchup.ok).toBe(false);
        if (catchup.ok) {
            return;
        }
        expect(catchup.error.code).toBe('DAG_VALIDATION_CATCHUP_RANGE_EXCEEDS_LIMIT');
    });
});
