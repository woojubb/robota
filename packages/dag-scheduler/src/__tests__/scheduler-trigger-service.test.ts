import { describe, expect, it } from 'vitest';
import {
    FakeClockPort,
    InMemoryQueuePort,
    InMemoryStoragePort,
    type IDagDefinition
} from '@robota-sdk/dag-core';
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

describe('SchedulerTriggerService', () => {
    it('triggers one scheduled run with explicit logicalDate', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));
        await storage.saveDefinition(createPublishedDefinition('dag-scheduler-one'));

        const service = new SchedulerTriggerService(new RunOrchestratorService(storage, queue, clock));
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

        const service = new SchedulerTriggerService(new RunOrchestratorService(storage, queue, clock));
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

        const service = new SchedulerTriggerService(new RunOrchestratorService(storage, queue, clock));
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

    it('rejects catchup with invalid start date', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));
        await storage.saveDefinition(createPublishedDefinition('dag-scheduler-invalid-date'));

        const service = new SchedulerTriggerService(new RunOrchestratorService(storage, queue, clock));
        const catchup = await service.triggerCatchup({
            dagId: 'dag-scheduler-invalid-date',
            rangeStartLogicalDate: 'not-a-date',
            rangeEndLogicalDate: '2026-02-14T09:00:00.000Z',
            slotIntervalMs: 3600000,
            maxSlots: 10,
            input: {}
        });

        expect(catchup.ok).toBe(false);
        if (!catchup.ok) {
            expect(catchup.error.code).toBe('DAG_VALIDATION_INVALID_LOGICAL_DATE');
        }
    });

    it('rejects catchup with invalid end date', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));
        await storage.saveDefinition(createPublishedDefinition('dag-scheduler-invalid-end'));

        const service = new SchedulerTriggerService(new RunOrchestratorService(storage, queue, clock));
        const catchup = await service.triggerCatchup({
            dagId: 'dag-scheduler-invalid-end',
            rangeStartLogicalDate: '2026-02-14T07:00:00.000Z',
            rangeEndLogicalDate: 'bad-date',
            slotIntervalMs: 3600000,
            maxSlots: 10,
            input: {}
        });

        expect(catchup.ok).toBe(false);
        if (!catchup.ok) {
            expect(catchup.error.code).toBe('DAG_VALIDATION_INVALID_LOGICAL_DATE');
        }
    });

    it('rejects catchup with zero slotIntervalMs', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));
        await storage.saveDefinition(createPublishedDefinition('dag-scheduler-zero-interval'));

        const service = new SchedulerTriggerService(new RunOrchestratorService(storage, queue, clock));
        const catchup = await service.triggerCatchup({
            dagId: 'dag-scheduler-zero-interval',
            rangeStartLogicalDate: '2026-02-14T07:00:00.000Z',
            rangeEndLogicalDate: '2026-02-14T09:00:00.000Z',
            slotIntervalMs: 0,
            maxSlots: 10,
            input: {}
        });

        expect(catchup.ok).toBe(false);
        if (!catchup.ok) {
            expect(catchup.error.code).toBe('DAG_VALIDATION_INVALID_SLOT_INTERVAL');
        }
    });

    it('rejects catchup with negative slotIntervalMs', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));
        await storage.saveDefinition(createPublishedDefinition('dag-neg-interval'));

        const service = new SchedulerTriggerService(new RunOrchestratorService(storage, queue, clock));
        const catchup = await service.triggerCatchup({
            dagId: 'dag-neg-interval',
            rangeStartLogicalDate: '2026-02-14T07:00:00.000Z',
            rangeEndLogicalDate: '2026-02-14T09:00:00.000Z',
            slotIntervalMs: -1000,
            maxSlots: 10,
            input: {}
        });

        expect(catchup.ok).toBe(false);
        if (!catchup.ok) {
            expect(catchup.error.code).toBe('DAG_VALIDATION_INVALID_SLOT_INTERVAL');
        }
    });

    it('rejects catchup with zero maxSlots', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));
        await storage.saveDefinition(createPublishedDefinition('dag-zero-maxslots'));

        const service = new SchedulerTriggerService(new RunOrchestratorService(storage, queue, clock));
        const catchup = await service.triggerCatchup({
            dagId: 'dag-zero-maxslots',
            rangeStartLogicalDate: '2026-02-14T07:00:00.000Z',
            rangeEndLogicalDate: '2026-02-14T09:00:00.000Z',
            slotIntervalMs: 3600000,
            maxSlots: 0,
            input: {}
        });

        expect(catchup.ok).toBe(false);
        if (!catchup.ok) {
            expect(catchup.error.code).toBe('DAG_VALIDATION_INVALID_MAX_SLOTS');
        }
    });

    it('rejects catchup with negative maxSlots', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));
        await storage.saveDefinition(createPublishedDefinition('dag-neg-maxslots'));

        const service = new SchedulerTriggerService(new RunOrchestratorService(storage, queue, clock));
        const catchup = await service.triggerCatchup({
            dagId: 'dag-neg-maxslots',
            rangeStartLogicalDate: '2026-02-14T07:00:00.000Z',
            rangeEndLogicalDate: '2026-02-14T09:00:00.000Z',
            slotIntervalMs: 3600000,
            maxSlots: -5,
            input: {}
        });

        expect(catchup.ok).toBe(false);
        if (!catchup.ok) {
            expect(catchup.error.code).toBe('DAG_VALIDATION_INVALID_MAX_SLOTS');
        }
    });

    it('rejects catchup when end is before start', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));
        await storage.saveDefinition(createPublishedDefinition('dag-reversed-range'));

        const service = new SchedulerTriggerService(new RunOrchestratorService(storage, queue, clock));
        const catchup = await service.triggerCatchup({
            dagId: 'dag-reversed-range',
            rangeStartLogicalDate: '2026-02-14T09:00:00.000Z',
            rangeEndLogicalDate: '2026-02-14T07:00:00.000Z',
            slotIntervalMs: 3600000,
            maxSlots: 10,
            input: {}
        });

        expect(catchup.ok).toBe(false);
        if (!catchup.ok) {
            expect(catchup.error.code).toBe('DAG_VALIDATION_INVALID_CATCHUP_RANGE');
        }
    });

    it('handles single-slot catchup when start equals end', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));
        await storage.saveDefinition(createPublishedDefinition('dag-single-slot'));

        const service = new SchedulerTriggerService(new RunOrchestratorService(storage, queue, clock));
        const catchup = await service.triggerCatchup({
            dagId: 'dag-single-slot',
            rangeStartLogicalDate: '2026-02-14T07:00:00.000Z',
            rangeEndLogicalDate: '2026-02-14T07:00:00.000Z',
            slotIntervalMs: 3600000,
            maxSlots: 10,
            input: {}
        });

        expect(catchup.ok).toBe(true);
        if (catchup.ok) {
            expect(catchup.value.requestedSlotCount).toBe(1);
            expect(catchup.value.startedRuns).toHaveLength(1);
        }
    });

    it('batch returns error directly when first item fails', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));
        // No definition saved — will cause orchestrator to fail

        const service = new SchedulerTriggerService(new RunOrchestratorService(storage, queue, clock));
        const batch = await service.triggerScheduledBatch({
            items: [{
                dagId: 'nonexistent-dag',
                logicalDate: '2026-02-14T07:00:00.000Z',
                input: {}
            }]
        });

        expect(batch.ok).toBe(false);
    });

    it('batch returns partial result when second item fails', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));
        await storage.saveDefinition(createPublishedDefinition('dag-batch-partial'));

        const service = new SchedulerTriggerService(new RunOrchestratorService(storage, queue, clock));
        const batch = await service.triggerScheduledBatch({
            items: [
                {
                    dagId: 'dag-batch-partial',
                    logicalDate: '2026-02-14T07:00:00.000Z',
                    input: {}
                },
                {
                    dagId: 'nonexistent-dag',
                    logicalDate: '2026-02-14T08:00:00.000Z',
                    input: {}
                }
            ]
        });

        expect(batch.ok).toBe(true);
        if (batch.ok) {
            expect(batch.value.startedRuns).toHaveLength(1);
            expect(batch.value.partialError).toBeDefined();
        }
    });

    it('batch succeeds with empty items array', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));

        const service = new SchedulerTriggerService(new RunOrchestratorService(storage, queue, clock));
        const batch = await service.triggerScheduledBatch({ items: [] });

        expect(batch.ok).toBe(true);
        if (batch.ok) {
            expect(batch.value.startedRuns).toHaveLength(0);
        }
    });

    it('rejects catchup range when requested slots exceed maxSlots', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 7, 0, 0));
        await storage.saveDefinition(createPublishedDefinition('dag-scheduler-catchup-limit'));

        const service = new SchedulerTriggerService(new RunOrchestratorService(storage, queue, clock));
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
