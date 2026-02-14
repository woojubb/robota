import { describe, expect, it } from 'vitest';
import {
    FakeClockPort,
    InMemoryLeasePort,
    InMemoryQueuePort,
    InMemoryStoragePort,
    MockTaskExecutorPort,
    type IDagDefinition
} from '@robota-sdk/dag-core';
import { ProjectionReadModelService } from '@robota-sdk/dag-projection';
import { createDagExecutionComposition } from '../composition/create-dag-execution-composition.js';
import { DagObservabilityController } from '../controllers/dag-observability-controller.js';

function createPublishedDefinition(): IDagDefinition {
    return {
        dagId: 'dag-observability',
        version: 1,
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

describe('Dag observability flow E2E', () => {
    it('returns run/lineage/dashboard projections for completed run', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const lease = new InMemoryLeasePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 12, 0, 0));
        const executor = new MockTaskExecutorPort(async () => ({
            ok: true,
            output: { ok: true }
        }));

        await storage.saveDefinition(createPublishedDefinition());

        const composition = createDagExecutionComposition(
            { storage, queue, lease, executor, clock },
            {
                worker: {
                    workerId: 'worker-1',
                    leaseDurationMs: 30_000,
                    visibilityTimeoutMs: 30_000,
                    maxAttempts: 1,
                    defaultTimeoutMs: 100
                }
            }
        );
        const observability = new DagObservabilityController(new ProjectionReadModelService(storage));

        const started = await composition.runOrchestrator.startRun({
            dagId: 'dag-observability',
            trigger: 'manual',
            input: {}
        });
        expect(started.ok).toBe(true);
        if (!started.ok) {
            return;
        }

        const processed = await composition.workerLoop.processOnce();
        expect(processed.ok).toBe(true);

        const runProjection = await observability.queryRunProjection({
            dagRunId: started.value.dagRunId,
            correlationId: 'corr-observability-run'
        });
        expect(runProjection.ok).toBe(true);
        if (!runProjection.ok) {
            return;
        }
        expect(runProjection.data.dagRun.status).toBe('success');
        expect(runProjection.data.taskStatusSummary.success).toBe(1);

        const lineageProjection = await observability.queryLineageProjection({
            dagRunId: started.value.dagRunId,
            correlationId: 'corr-observability-lineage'
        });
        expect(lineageProjection.ok).toBe(true);
        if (!lineageProjection.ok) {
            return;
        }
        expect(lineageProjection.data.nodes).toHaveLength(1);
        expect(lineageProjection.data.nodes[0]?.taskStatus).toBe('success');

        const dashboard = await observability.queryDashboard({
            dagRunId: started.value.dagRunId,
            correlationId: 'corr-observability-dashboard'
        });
        expect(dashboard.ok).toBe(true);
        if (!dashboard.ok) {
            return;
        }
        expect(dashboard.data.runProjection.dagRun.status).toBe('success');
        expect(dashboard.data.lineageProjection.nodes[0]?.taskStatus).toBe('success');
    });
});
