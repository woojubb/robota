import { describe, expect, it } from 'vitest';
import {
    FakeClockPort,
    InMemoryQueuePort,
    InMemoryStoragePort,
    type IDagDefinition
} from '@robota-sdk/dag-core';
import { RunCancelService, RunOrchestratorService, RunQueryService } from '@robota-sdk/dag-runtime';
import { DagRuntimeController } from '../controllers/dag-runtime-controller.js';

function createPublishedDefinition(): IDagDefinition {
    return {
        dagId: 'dag-runtime-e2e',
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

describe('DagRuntimeController E2E', () => {
    it('runs trigger -> query -> cancel flow', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 5, 0, 0));
        await storage.saveDefinition(createPublishedDefinition());

        const controller = new DagRuntimeController(
            new RunOrchestratorService(storage, queue, clock),
            new RunQueryService(storage),
            new RunCancelService(storage, clock)
        );

        const triggered = await controller.triggerRun({
            dagId: 'dag-runtime-e2e',
            trigger: 'manual',
            input: {},
            correlationId: 'corr-runtime-trigger'
        });
        expect(triggered.ok).toBe(true);
        if (!triggered.ok) {
            return;
        }
        expect(triggered.status).toBe(201);

        const queried = await controller.queryRun({
            dagRunId: triggered.data.dagRunId,
            correlationId: 'corr-runtime-query'
        });
        expect(queried.ok).toBe(true);
        if (!queried.ok) {
            return;
        }
        expect(queried.data.dagRun.status).toBe('running');
        expect(queried.data.taskRuns.length).toBe(1);

        const cancelled = await controller.cancelRun({
            dagRunId: triggered.data.dagRunId,
            correlationId: 'corr-runtime-cancel'
        });
        expect(cancelled.ok).toBe(true);
        if (!cancelled.ok) {
            return;
        }
        expect(cancelled.data.status).toBe('cancelled');

        const afterCancel = await controller.queryRun({
            dagRunId: triggered.data.dagRunId,
            correlationId: 'corr-runtime-query-after-cancel'
        });
        expect(afterCancel.ok).toBe(true);
        if (!afterCancel.ok) {
            return;
        }
        expect(afterCancel.data.dagRun.status).toBe('cancelled');
    });

    it('returns not found for unknown dagRun query', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 5, 0, 0));
        const controller = new DagRuntimeController(
            new RunOrchestratorService(storage, queue, clock),
            new RunQueryService(storage),
            new RunCancelService(storage, clock)
        );

        const queried = await controller.queryRun({
            dagRunId: 'missing-run',
            correlationId: 'corr-runtime-missing'
        });

        expect(queried.ok).toBe(false);
        if (queried.ok) {
            return;
        }
        expect(queried.status).toBe(404);
        expect(queried.errors[0]?.code).toBe('DAG_VALIDATION_DAG_RUN_NOT_FOUND');
    });
});
