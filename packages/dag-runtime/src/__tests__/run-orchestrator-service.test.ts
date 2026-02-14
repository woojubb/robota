import { describe, expect, it } from 'vitest';
import {
    FakeClockPort,
    InMemoryQueuePort,
    InMemoryStoragePort,
    type IDagDefinition
} from '@robota-sdk/dag-core';
import { RunOrchestratorService } from '../services/run-orchestrator-service.js';

function createPublishedDefinition(): IDagDefinition {
    return {
        dagId: 'dag-runtime-test',
        version: 1,
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
        edges: [
            { from: 'entry', to: 'next' }
        ]
    };
}

describe('RunOrchestratorService', () => {
    it('creates run and enqueues entry task', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 2, 0, 0));

        await storage.saveDefinition(createPublishedDefinition());
        const service = new RunOrchestratorService(storage, queue, clock);

        const started = await service.startRun({
            dagId: 'dag-runtime-test',
            trigger: 'manual',
            input: { seed: 'v1' }
        });

        expect(started.ok).toBe(true);
        if (!started.ok) {
            return;
        }

        const run = await storage.getDagRun(started.value.dagRunId);
        expect(run?.status).toBe('running');

        const message = await queue.dequeue('worker-1', 1_000);
        expect(message?.dagRunId).toBe(started.value.dagRunId);
        expect(message?.nodeId).toBe('entry');
    });

    it('fails when published definition is missing', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 2, 0, 0));

        const service = new RunOrchestratorService(storage, queue, clock);
        const started = await service.startRun({
            dagId: 'missing-dag',
            trigger: 'manual',
            input: {}
        });

        expect(started.ok).toBe(false);
        if (started.ok) {
            return;
        }

        expect(started.error.code).toBe('DAG_VALIDATION_DEFINITION_NOT_FOUND');
    });

    it('fails for scheduled trigger without logicalDate', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 2, 0, 0));

        await storage.saveDefinition(createPublishedDefinition());
        const service = new RunOrchestratorService(storage, queue, clock);

        const started = await service.startRun({
            dagId: 'dag-runtime-test',
            trigger: 'scheduled',
            input: {}
        });

        expect(started.ok).toBe(false);
        if (started.ok) {
            return;
        }

        expect(started.error.code).toBe('DAG_VALIDATION_MISSING_LOGICAL_DATE');
    });

    it('returns existing dagRun for duplicate runKey trigger (idempotent)', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 2, 0, 0));

        await storage.saveDefinition(createPublishedDefinition());
        const service = new RunOrchestratorService(storage, queue, clock);

        const first = await service.startRun({
            dagId: 'dag-runtime-test',
            trigger: 'manual',
            input: { seed: 'v1' }
        });
        expect(first.ok).toBe(true);
        if (!first.ok) {
            return;
        }

        const second = await service.startRun({
            dagId: 'dag-runtime-test',
            trigger: 'manual',
            input: { seed: 'v1' }
        });
        expect(second.ok).toBe(true);
        if (!second.ok) {
            return;
        }

        expect(second.value.dagRunId).toBe(first.value.dagRunId);
        expect(second.value.taskRunIds).toEqual(first.value.taskRunIds);

        const firstMessage = await queue.dequeue('worker-1', 1_000);
        expect(firstMessage?.dagRunId).toBe(first.value.dagRunId);

        const secondMessage = await queue.dequeue('worker-1', 1_000);
        expect(secondMessage).toBeUndefined();
    });
});
