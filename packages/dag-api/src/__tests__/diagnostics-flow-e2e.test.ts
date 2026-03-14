import { describe, expect, it } from 'vitest';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import {
    FakeClockPort,
    InMemoryLeasePort,
    InMemoryQueuePort,
    InMemoryStoragePort,
    MockTaskExecutorPort
} from '@robota-sdk/dag-adapters-memory';
import { RunOrchestratorService, RunQueryService } from '@robota-sdk/dag-runtime';
import { DlqReinjectService } from '@robota-sdk/dag-worker';
import { createDagExecutionComposition } from '../composition/create-dag-execution-composition.js';
import { DagDiagnosticsController } from '../controllers/dag-diagnostics-controller.js';

function createPublishedDefinition(): IDagDefinition {
    return {
        dagId: 'dag-diagnostics',
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

describe('Dag diagnostics flow E2E', () => {
    it('blocks dead letter reinject by default policy', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const deadLetterQueue = new InMemoryQueuePort();
        const lease = new InMemoryLeasePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 13, 0, 0));
        const executor = new MockTaskExecutorPort(async () => ({
            ok: false,
            error: {
                code: 'DAG_TASK_EXECUTION_HARD_FAIL',
                category: 'task_execution',
                message: 'Hard failure',
                retryable: false
            }
        }));

        await storage.saveDefinition(createPublishedDefinition());

        const composition = createDagExecutionComposition(
            { storage, queue, deadLetterQueue, lease, executor, clock },
            {
                worker: {
                    workerId: 'worker-1',
                    leaseDurationMs: 30_000,
                    visibilityTimeoutMs: 30_000,
                    maxAttempts: 1,
                    defaultTimeoutMs: 100,
                    deadLetterEnabled: true
                }
            }
        );
        const diagnostics = new DagDiagnosticsController(
            new RunQueryService(storage),
            new RunOrchestratorService(storage, queue, clock),
            new DlqReinjectService(storage, deadLetterQueue, queue, lease, clock)
        );

        const started = await composition.runOrchestrator.startRun({
            dagId: 'dag-diagnostics',
            trigger: 'manual',
            input: {}
        });
        expect(started.ok).toBe(true);
        if (!started.ok) {
            return;
        }

        const processed = await composition.workerLoop.processOnce();
        expect(processed.ok).toBe(true);

        const failure = await diagnostics.analyzeFailure({
            dagRunId: started.value.dagRunId,
            correlationId: 'corr-diagnostics-failure'
        });
        expect(failure.ok).toBe(true);
        if (!failure.ok) {
            return;
        }
        expect(failure.data.failedTaskRuns).toHaveLength(1);
        expect(failure.data.failureCodeCounts[0]?.code).toBe('DAG_TASK_EXECUTION_HARD_FAIL');

        const reinjected = await diagnostics.reinjectDeadLetter({
            workerId: 'dlq-worker-1',
            visibilityTimeoutMs: 30_000,
            correlationId: 'corr-diagnostics-reinject'
        });
        expect(reinjected.ok).toBe(false);
        if (reinjected.ok) {
            return;
        }
        expect(reinjected.status).toBe(409);
        expect(reinjected.errors[0]?.code).toBe('DAG_POLICY_REINJECT_DISABLED');
    });

    it('allows reinject only when diagnostics policy explicitly enables it', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const deadLetterQueue = new InMemoryQueuePort();
        const lease = new InMemoryLeasePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 13, 0, 0));
        const executor = new MockTaskExecutorPort(async () => ({
            ok: false,
            error: {
                code: 'DAG_TASK_EXECUTION_HARD_FAIL',
                category: 'task_execution',
                message: 'Hard failure',
                retryable: false
            }
        }));

        await storage.saveDefinition(createPublishedDefinition());

        const composition = createDagExecutionComposition(
            { storage, queue, deadLetterQueue, lease, executor, clock },
            {
                worker: {
                    workerId: 'worker-1',
                    leaseDurationMs: 30_000,
                    visibilityTimeoutMs: 30_000,
                    maxAttempts: 1,
                    defaultTimeoutMs: 100,
                    deadLetterEnabled: true
                }
            }
        );
        const diagnostics = new DagDiagnosticsController(
            new RunQueryService(storage),
            new RunOrchestratorService(storage, queue, clock),
            new DlqReinjectService(storage, deadLetterQueue, queue, lease, clock),
            { reinjectEnabled: true }
        );

        const started = await composition.runOrchestrator.startRun({
            dagId: 'dag-diagnostics',
            trigger: 'manual',
            input: {}
        });
        expect(started.ok).toBe(true);
        if (!started.ok) {
            return;
        }

        const processed = await composition.workerLoop.processOnce();
        expect(processed.ok).toBe(true);

        const reinjected = await diagnostics.reinjectDeadLetter({
            workerId: 'dlq-worker-1',
            visibilityTimeoutMs: 30_000,
            correlationId: 'corr-diagnostics-reinject-enabled'
        });
        expect(reinjected.ok).toBe(true);
        if (!reinjected.ok) {
            return;
        }
        expect(reinjected.data.reinjected).toBe(true);

        const rerun = await diagnostics.rerun({
            sourceDagRunId: started.value.dagRunId,
            rerunKey: 'manual-rerun-1',
            input: { reason: 'manual-diagnostic-rerun' },
            correlationId: 'corr-diagnostics-rerun'
        });
        expect(rerun.ok).toBe(true);
        if (!rerun.ok) {
            return;
        }
        expect(rerun.data.rerunDagRunId).not.toBe(started.value.dagRunId);
    });
});
