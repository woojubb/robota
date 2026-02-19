import { describe, expect, it } from 'vitest';
import {
    FakeClockPort,
    InMemoryQueuePort,
    InMemoryStoragePort,
    type IDagRun,
    type IDagDefinition,
    type IQueueMessage,
    type IQueuePort
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
                config: {},
                inputs: [],
                outputs: []
            },
            {
                nodeId: 'next',
                nodeType: 'processor',
                dependsOn: ['entry'],
                config: {},
                inputs: [],
                outputs: []
            }
        ],
        edges: [
            { from: 'entry', to: 'next' }
        ]
    };
}

function createPublishedDefinitionWithTwoEntries(): IDagDefinition {
    return {
        dagId: 'dag-runtime-test-two-entries',
        version: 1,
        status: 'published',
        nodes: [
            {
                nodeId: 'entry-a',
                nodeType: 'input',
                dependsOn: [],
                config: {},
                inputs: [],
                outputs: []
            },
            {
                nodeId: 'entry-b',
                nodeType: 'input',
                dependsOn: [],
                config: {},
                inputs: [],
                outputs: []
            },
            {
                nodeId: 'join',
                nodeType: 'processor',
                dependsOn: ['entry-a', 'entry-b'],
                config: {},
                inputs: [],
                outputs: []
            }
        ],
        edges: [
            { from: 'entry-a', to: 'join' },
            { from: 'entry-b', to: 'join' }
        ]
    };
}

function createPublishedDefinitionWithoutEntryNode(): IDagDefinition {
    return {
        dagId: 'dag-runtime-test-no-entry',
        version: 1,
        status: 'published',
        nodes: [
            {
                nodeId: 'a',
                nodeType: 'processor',
                dependsOn: ['b'],
                config: {},
                inputs: [],
                outputs: []
            },
            {
                nodeId: 'b',
                nodeType: 'processor',
                dependsOn: ['a'],
                config: {},
                inputs: [],
                outputs: []
            }
        ],
        edges: [
            { from: 'a', to: 'b' },
            { from: 'b', to: 'a' }
        ]
    };
}

class FailingQueuePort implements IQueuePort {
    private enqueueCount = 0;
    private readonly pendingQueue: IQueueMessage[] = [];

    public constructor(private readonly failAtCount: number) {}

    public async enqueue(message: IQueueMessage): Promise<void> {
        this.enqueueCount += 1;
        if (this.enqueueCount === this.failAtCount) {
            throw new Error('forced enqueue failure');
        }
        this.pendingQueue.push(message);
    }

    public async dequeue(_workerId: string, _visibilityTimeoutMs: number): Promise<IQueueMessage | undefined> {
        return this.pendingQueue.shift();
    }

    public async ack(_messageId: string): Promise<void> {}

    public async nack(_messageId: string): Promise<void> {}
}

class RacyDagRunStoragePort extends InMemoryStoragePort {
    private hasInjectedRacyRun = false;

    public override async createDagRun(dagRun: IDagRun): Promise<void> {
        if (!this.hasInjectedRacyRun) {
            this.hasInjectedRacyRun = true;
            await super.createDagRun(dagRun);
            throw new Error('duplicate dag run key');
        }
        await super.createDagRun(dagRun);
    }
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

    it('starts existing created run without creating duplicate run id', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 2, 0, 0));

        await storage.saveDefinition(createPublishedDefinition());
        const service = new RunOrchestratorService(storage, queue, clock);

        const created = await service.createRun({
            dagId: 'dag-runtime-test',
            trigger: 'manual',
            input: { seed: 'v2' }
        });
        expect(created.ok).toBe(true);
        if (!created.ok) {
            return;
        }
        expect(created.value.status).toBe('created');

        const started = await service.startRun({
            dagId: 'dag-runtime-test',
            trigger: 'manual',
            input: { seed: 'v2' }
        });
        expect(started.ok).toBe(true);
        if (!started.ok) {
            return;
        }

        expect(started.value.dagRunId).toBe(created.value.dagRunId);
        const queuedMessage = await queue.dequeue('worker-1', 1_000);
        expect(queuedMessage?.dagRunId).toBe(created.value.dagRunId);
    });

    it('treats startCreatedRun as idempotent for already running run', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 2, 0, 0));

        await storage.saveDefinition(createPublishedDefinition());
        const service = new RunOrchestratorService(storage, queue, clock);

        const started = await service.startRun({
            dagId: 'dag-runtime-test',
            trigger: 'manual',
            input: { seed: 'v3' }
        });
        expect(started.ok).toBe(true);
        if (!started.ok) {
            return;
        }

        const second = await service.startCreatedRun(started.value.dagRunId);
        expect(second.ok).toBe(true);
        if (!second.ok) {
            return;
        }

        expect(second.value.dagRunId).toBe(started.value.dagRunId);
        expect(second.value.taskRunIds).toEqual(started.value.taskRunIds);
        const firstMessage = await queue.dequeue('worker-1', 1_000);
        expect(firstMessage?.dagRunId).toBe(started.value.dagRunId);
        const secondMessage = await queue.dequeue('worker-1', 1_000);
        expect(secondMessage).toBeUndefined();
    });

    it('keeps run in created state when definition has no entry node', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 2, 0, 0));

        await storage.saveDefinition(createPublishedDefinitionWithoutEntryNode());
        const service = new RunOrchestratorService(storage, queue, clock);

        const started = await service.startRun({
            dagId: 'dag-runtime-test-no-entry',
            trigger: 'manual',
            input: {}
        });

        expect(started.ok).toBe(false);
        if (started.ok) {
            return;
        }
        expect(started.error.code).toBe('DAG_VALIDATION_NO_ENTRY_NODE');

        const run = (await storage.listDagRuns()).find((item) => item.dagId === 'dag-runtime-test-no-entry');
        expect(run?.status).toBe('created');
    });

    it('marks run failed when enqueue fails during start', async () => {
        const storage = new InMemoryStoragePort();
        const queue = new FailingQueuePort(2);
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 2, 0, 0));

        await storage.saveDefinition(createPublishedDefinitionWithTwoEntries());
        const service = new RunOrchestratorService(storage, queue, clock);

        const started = await service.startRun({
            dagId: 'dag-runtime-test-two-entries',
            trigger: 'manual',
            input: { seed: 'v4' }
        });

        expect(started.ok).toBe(false);
        if (started.ok) {
            return;
        }
        expect(started.error.code).toBe('DAG_DISPATCH_ENQUEUE_FAILED');

        const run = (await storage.listDagRuns()).find((item) => item.dagId === 'dag-runtime-test-two-entries');
        expect(run?.status).toBe('failed');
        expect(run?.endedAt).toBe('2026-02-14T02:00:00.000Z');

        if (!run) {
            return;
        }
        const failedTaskRun = await storage.getTaskRun(`${run.dagRunId}:entry-b:attempt:1`);
        expect(failedTaskRun?.status).toBe('cancelled');
        expect(failedTaskRun?.errorCode).toBe('DAG_DISPATCH_ENQUEUE_FAILED');
    });

    it('returns existing run when createDagRun races with concurrent writer', async () => {
        const storage = new RacyDagRunStoragePort();
        const queue = new InMemoryQueuePort();
        const clock = new FakeClockPort(Date.UTC(2026, 1, 14, 2, 0, 0));

        await storage.saveDefinition(createPublishedDefinition());
        const service = new RunOrchestratorService(storage, queue, clock);

        const created = await service.createRun({
            dagId: 'dag-runtime-test',
            trigger: 'manual',
            input: { seed: 'race-case' }
        });

        expect(created.ok).toBe(true);
        if (!created.ok) {
            return;
        }
        expect(created.value.status).toBe('created');
    });
});
