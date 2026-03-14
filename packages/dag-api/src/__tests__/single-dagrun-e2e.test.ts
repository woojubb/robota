import { describe, expect, it } from 'vitest';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import {
    FakeClockPort,
    InMemoryLeasePort,
    InMemoryQueuePort,
    InMemoryStoragePort,
    MockTaskExecutorPort
} from '@robota-sdk/dag-adapters-local';
import { createDagExecutionComposition } from '../composition/create-dag-execution-composition.js';

function createPublishedDefinition(): IDagDefinition {
    return {
        dagId: 'dag-single-run-e2e',
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

describe('Single DagRun E2E (mock infra)', () => {
    it('completes one-run path from trigger to terminal success', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const lease = new InMemoryLeasePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 6, 0, 0));
        const executor = new MockTaskExecutorPort(async () => ({
            ok: true,
            output: { result: 'ok' }
        }));

        await storage.saveDefinition(createPublishedDefinition());

        const composition = createDagExecutionComposition(
            { storage, queue, lease, executor, clock },
            {
                worker: {
                    workerId: 'worker-1',
                    leaseDurationMs: 30_000,
                    visibilityTimeoutMs: 30_000,
                    maxAttempts: 3,
                    defaultTimeoutMs: 100
                }
            }
        );

        const started = await composition.runOrchestrator.startRun({
            dagId: 'dag-single-run-e2e',
            trigger: 'manual',
            input: {}
        });
        expect(started.ok).toBe(true);
        if (!started.ok) {
            return;
        }

        const processed = await composition.workerLoop.processOnce();
        expect(processed.ok).toBe(true);
        if (!processed.ok) {
            return;
        }

        const queried = await composition.runQuery.getRun(started.value.dagRunId);
        expect(queried.ok).toBe(true);
        if (!queried.ok) {
            return;
        }
        expect(queried.value.dagRun.status).toBe('success');
        expect(queried.value.taskRuns).toHaveLength(1);
        expect(queried.value.taskRuns[0]?.status).toBe('success');
    });
});
