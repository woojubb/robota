import { describe, expect, it } from 'vitest';
import { InMemoryStoragePort } from '../testing/in-memory-storage-port.js';
import { InMemoryQueuePort } from '../testing/in-memory-queue-port.js';
import { InMemoryLeasePort } from '../testing/in-memory-lease-port.js';
import { FakeClockPort, SystemClockPort } from '../testing/fake-clock-port.js';
import { MockTaskExecutorPort } from '../testing/mock-task-executor-port.js';
import type { IDagDefinition, IDagRun, ITaskRun } from '../types/domain.js';
import type { IQueueMessage } from '../interfaces/ports.js';

// ---- InMemoryStoragePort ----

function makeDef(dagId: string, version: number, status: 'draft' | 'published' = 'draft'): IDagDefinition {
    return {
        dagId,
        version,
        status,
        nodes: [{ nodeId: 'n1', nodeType: 'test', dependsOn: [], config: {}, inputs: [], outputs: [] }],
        edges: []
    };
}

function makeRun(dagRunId: string, dagId: string = 'dag-1'): IDagRun {
    return {
        dagRunId,
        dagId,
        version: 1,
        status: 'created',
        runKey: `rk-${dagRunId}`,
        logicalDate: '2026-01-01T00:00:00.000Z',
        trigger: 'manual'
    };
}

function makeTask(taskRunId: string, dagRunId: string): ITaskRun {
    return {
        taskRunId,
        dagRunId,
        nodeId: 'n1',
        status: 'created',
        attempt: 1
    };
}

describe('InMemoryStoragePort', () => {
    describe('definitions', () => {
        it('saves and retrieves a definition', async () => {
            const storage = new InMemoryStoragePort();
            const def = makeDef('dag-1', 1);
            await storage.saveDefinition(def);
            const retrieved = await storage.getDefinition('dag-1', 1);
            expect(retrieved).toEqual(def);
        });

        it('returns undefined for missing definition', async () => {
            const storage = new InMemoryStoragePort();
            expect(await storage.getDefinition('missing', 1)).toBeUndefined();
        });

        it('lists all definitions sorted', async () => {
            const storage = new InMemoryStoragePort();
            await storage.saveDefinition(makeDef('b', 1));
            await storage.saveDefinition(makeDef('a', 1));
            const list = await storage.listDefinitions();
            expect(list[0].dagId).toBe('a');
            expect(list[1].dagId).toBe('b');
        });

        it('lists definitions by dagId', async () => {
            const storage = new InMemoryStoragePort();
            await storage.saveDefinition(makeDef('dag-1', 1));
            await storage.saveDefinition(makeDef('dag-1', 2));
            await storage.saveDefinition(makeDef('dag-2', 1));
            const list = await storage.listDefinitionsByDagId('dag-1');
            expect(list).toHaveLength(2);
        });

        it('tracks latest published definition', async () => {
            const storage = new InMemoryStoragePort();
            await storage.saveDefinition(makeDef('dag-1', 1, 'published'));
            await storage.saveDefinition(makeDef('dag-1', 2, 'published'));
            const latest = await storage.getLatestPublishedDefinition('dag-1');
            expect(latest?.version).toBe(2);
        });

        it('returns undefined for unpublished dag latest', async () => {
            const storage = new InMemoryStoragePort();
            await storage.saveDefinition(makeDef('dag-1', 1));
            expect(await storage.getLatestPublishedDefinition('dag-1')).toBeUndefined();
        });

        it('deletes a definition and updates latest published', async () => {
            const storage = new InMemoryStoragePort();
            await storage.saveDefinition(makeDef('dag-1', 1, 'published'));
            await storage.saveDefinition(makeDef('dag-1', 2, 'published'));
            await storage.deleteDefinition('dag-1', 2);
            const latest = await storage.getLatestPublishedDefinition('dag-1');
            expect(latest?.version).toBe(1);
        });

        it('clears latest published when all published deleted', async () => {
            const storage = new InMemoryStoragePort();
            await storage.saveDefinition(makeDef('dag-1', 1, 'published'));
            await storage.deleteDefinition('dag-1', 1);
            expect(await storage.getLatestPublishedDefinition('dag-1')).toBeUndefined();
        });
    });

    describe('dag runs', () => {
        it('creates and retrieves a dag run', async () => {
            const storage = new InMemoryStoragePort();
            const run = makeRun('run-1');
            await storage.createDagRun(run);
            expect(await storage.getDagRun('run-1')).toEqual(run);
        });

        it('returns undefined for missing dag run', async () => {
            const storage = new InMemoryStoragePort();
            expect(await storage.getDagRun('missing')).toBeUndefined();
        });

        it('lists all dag runs', async () => {
            const storage = new InMemoryStoragePort();
            await storage.createDagRun(makeRun('run-2'));
            await storage.createDagRun(makeRun('run-1'));
            const list = await storage.listDagRuns();
            expect(list).toHaveLength(2);
            expect(list[0].dagRunId).toBe('run-1');
        });

        it('finds dag run by runKey', async () => {
            const storage = new InMemoryStoragePort();
            await storage.createDagRun(makeRun('run-1'));
            const found = await storage.getDagRunByRunKey('rk-run-1');
            expect(found?.dagRunId).toBe('run-1');
        });

        it('returns undefined for missing runKey', async () => {
            const storage = new InMemoryStoragePort();
            expect(await storage.getDagRunByRunKey('missing')).toBeUndefined();
        });

        it('updates dag run status', async () => {
            const storage = new InMemoryStoragePort();
            await storage.createDagRun(makeRun('run-1'));
            await storage.updateDagRunStatus('run-1', 'running');
            const run = await storage.getDagRun('run-1');
            expect(run?.status).toBe('running');
        });

        it('updates dag run status with endedAt', async () => {
            const storage = new InMemoryStoragePort();
            await storage.createDagRun(makeRun('run-1'));
            await storage.updateDagRunStatus('run-1', 'success', '2026-01-01T12:00:00.000Z');
            const run = await storage.getDagRun('run-1');
            expect(run?.endedAt).toBe('2026-01-01T12:00:00.000Z');
        });

        it('no-ops on updating missing run', async () => {
            const storage = new InMemoryStoragePort();
            // should not throw
            await storage.updateDagRunStatus('missing', 'running');
        });

        it('deletes a dag run', async () => {
            const storage = new InMemoryStoragePort();
            await storage.createDagRun(makeRun('run-1'));
            await storage.deleteDagRun('run-1');
            expect(await storage.getDagRun('run-1')).toBeUndefined();
        });
    });

    describe('task runs', () => {
        it('creates and retrieves a task run', async () => {
            const storage = new InMemoryStoragePort();
            const task = makeTask('task-1', 'run-1');
            await storage.createTaskRun(task);
            expect(await storage.getTaskRun('task-1')).toEqual(task);
        });

        it('returns undefined for missing task run', async () => {
            const storage = new InMemoryStoragePort();
            expect(await storage.getTaskRun('missing')).toBeUndefined();
        });

        it('lists task runs by dagRunId', async () => {
            const storage = new InMemoryStoragePort();
            await storage.createTaskRun(makeTask('task-1', 'run-1'));
            await storage.createTaskRun(makeTask('task-2', 'run-1'));
            await storage.createTaskRun(makeTask('task-3', 'run-2'));
            const list = await storage.listTaskRunsByDagRunId('run-1');
            expect(list).toHaveLength(2);
        });

        it('deletes task runs by dagRunId', async () => {
            const storage = new InMemoryStoragePort();
            await storage.createTaskRun(makeTask('task-1', 'run-1'));
            await storage.createTaskRun(makeTask('task-2', 'run-1'));
            await storage.deleteTaskRunsByDagRunId('run-1');
            const list = await storage.listTaskRunsByDagRunId('run-1');
            expect(list).toHaveLength(0);
        });

        it('updates task run status', async () => {
            const storage = new InMemoryStoragePort();
            await storage.createTaskRun(makeTask('task-1', 'run-1'));
            await storage.updateTaskRunStatus('task-1', 'running');
            const task = await storage.getTaskRun('task-1');
            expect(task?.status).toBe('running');
        });

        it('updates task run status with error', async () => {
            const storage = new InMemoryStoragePort();
            await storage.createTaskRun(makeTask('task-1', 'run-1'));
            await storage.updateTaskRunStatus('task-1', 'failed', {
                code: 'ERR',
                category: 'task_execution',
                message: 'Failed',
                retryable: false
            });
            const task = await storage.getTaskRun('task-1');
            expect(task?.errorCode).toBe('ERR');
            expect(task?.errorMessage).toBe('Failed');
        });

        it('saves task run snapshots', async () => {
            const storage = new InMemoryStoragePort();
            await storage.createTaskRun(makeTask('task-1', 'run-1'));
            await storage.saveTaskRunSnapshots('task-1', '{"in":1}', '{"out":2}', 0.5, 1.0);
            const task = await storage.getTaskRun('task-1');
            expect(task?.inputSnapshot).toBe('{"in":1}');
            expect(task?.outputSnapshot).toBe('{"out":2}');
            expect(task?.estimatedCredits).toBe(0.5);
            expect(task?.totalCredits).toBe(1.0);
        });

        it('increments task attempt', async () => {
            const storage = new InMemoryStoragePort();
            await storage.createTaskRun(makeTask('task-1', 'run-1'));
            await storage.incrementTaskAttempt('task-1');
            const task = await storage.getTaskRun('task-1');
            expect(task?.attempt).toBe(2);
        });
    });
});

// ---- InMemoryQueuePort ----

describe('InMemoryQueuePort', () => {
    function makeMessage(messageId: string): IQueueMessage {
        return {
            messageId,
            dagRunId: 'run-1',
            taskRunId: 'task-1',
            nodeId: 'n1',
            attempt: 1,
            executionPath: [],
            payload: {},
            createdAt: new Date().toISOString()
        };
    }

    it('enqueues and dequeues a message', async () => {
        const queue = new InMemoryQueuePort();
        await queue.enqueue(makeMessage('msg-1'));
        const msg = await queue.dequeue('worker-1', 30000);
        expect(msg?.messageId).toBe('msg-1');
    });

    it('returns undefined when queue is empty', async () => {
        const queue = new InMemoryQueuePort();
        expect(await queue.dequeue('worker-1', 30000)).toBeUndefined();
    });

    it('ack removes message from in-flight', async () => {
        const queue = new InMemoryQueuePort();
        await queue.enqueue(makeMessage('msg-1'));
        await queue.dequeue('worker-1', 30000);
        await queue.ack('msg-1');
        // After ack, re-dequeue should return nothing
        expect(await queue.dequeue('worker-1', 30000)).toBeUndefined();
    });

    it('nack returns message to queue', async () => {
        const queue = new InMemoryQueuePort();
        await queue.enqueue(makeMessage('msg-1'));
        await queue.dequeue('worker-1', 30000);
        await queue.nack('msg-1');
        const msg = await queue.dequeue('worker-1', 30000);
        expect(msg?.messageId).toBe('msg-1');
    });

    it('nack is no-op for unknown messageId', async () => {
        const queue = new InMemoryQueuePort();
        // should not throw
        await queue.nack('unknown');
    });
});

// ---- InMemoryLeasePort ----

describe('InMemoryLeasePort', () => {
    it('acquires a lease', async () => {
        const lease = new InMemoryLeasePort();
        const record = await lease.acquire('key-1', 'owner-1', 60000);
        expect(record).toBeDefined();
        expect(record?.leaseKey).toBe('key-1');
        expect(record?.ownerId).toBe('owner-1');
    });

    it('prevents double-acquire while lease is active', async () => {
        const lease = new InMemoryLeasePort();
        await lease.acquire('key-1', 'owner-1', 60000);
        const second = await lease.acquire('key-1', 'owner-2', 60000);
        expect(second).toBeUndefined();
    });

    it('renews an existing lease', async () => {
        const lease = new InMemoryLeasePort();
        await lease.acquire('key-1', 'owner-1', 60000);
        const renewed = await lease.renew('key-1', 'owner-1', 120000);
        expect(renewed).toBeDefined();
    });

    it('refuses renew from different owner', async () => {
        const lease = new InMemoryLeasePort();
        await lease.acquire('key-1', 'owner-1', 60000);
        const renewed = await lease.renew('key-1', 'owner-2', 120000);
        expect(renewed).toBeUndefined();
    });

    it('refuses renew for nonexistent lease', async () => {
        const lease = new InMemoryLeasePort();
        expect(await lease.renew('key-1', 'owner-1', 60000)).toBeUndefined();
    });

    it('releases a lease', async () => {
        const lease = new InMemoryLeasePort();
        await lease.acquire('key-1', 'owner-1', 60000);
        await lease.release('key-1', 'owner-1');
        const record = await lease.get('key-1');
        expect(record).toBeUndefined();
    });

    it('refuses release from different owner', async () => {
        const lease = new InMemoryLeasePort();
        await lease.acquire('key-1', 'owner-1', 60000);
        await lease.release('key-1', 'owner-2');
        const record = await lease.get('key-1');
        expect(record).toBeDefined();
    });

    it('gets lease record', async () => {
        const lease = new InMemoryLeasePort();
        await lease.acquire('key-1', 'owner-1', 60000);
        const record = await lease.get('key-1');
        expect(record?.ownerId).toBe('owner-1');
    });

    it('returns undefined for nonexistent lease', async () => {
        const lease = new InMemoryLeasePort();
        expect(await lease.get('missing')).toBeUndefined();
    });
});

// ---- FakeClockPort / SystemClockPort ----

describe('FakeClockPort', () => {
    it('returns configured time', () => {
        const clock = new FakeClockPort(1000);
        expect(clock.nowEpochMs()).toBe(1000);
        expect(clock.nowIso()).toBe(new Date(1000).toISOString());
    });

    it('advances time', () => {
        const clock = new FakeClockPort(1000);
        clock.advanceByMs(500);
        expect(clock.nowEpochMs()).toBe(1500);
    });

    it('sets absolute time', () => {
        const clock = new FakeClockPort(1000);
        clock.setNowEpochMs(5000);
        expect(clock.nowEpochMs()).toBe(5000);
    });
});

describe('SystemClockPort', () => {
    it('returns current time', () => {
        const clock = new SystemClockPort();
        const before = Date.now();
        const epochMs = clock.nowEpochMs();
        const after = Date.now();
        expect(epochMs).toBeGreaterThanOrEqual(before);
        expect(epochMs).toBeLessThanOrEqual(after);
    });

    it('returns ISO string', () => {
        const clock = new SystemClockPort();
        const iso = clock.nowIso();
        expect(new Date(iso).toISOString()).toBe(iso);
    });
});

// ---- MockTaskExecutorPort ----

describe('MockTaskExecutorPort', () => {
    it('returns default success result (passes input through)', async () => {
        const mock = new MockTaskExecutorPort();
        const result = await mock.execute({
            dagId: 'dag-1',
            dagRunId: 'run-1',
            taskRunId: 'task-1',
            nodeId: 'n1',
            attempt: 1,
            executionPath: [],
            input: { text: 'hello' }
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.output).toEqual({ text: 'hello' });
    });

    it('uses custom executor function', async () => {
        const mock = new MockTaskExecutorPort(async () => ({
            ok: true,
            output: { custom: 'result' }
        }));
        const result = await mock.execute({
            dagId: 'dag-1',
            dagRunId: 'run-1',
            taskRunId: 'task-1',
            nodeId: 'n1',
            attempt: 1,
            executionPath: [],
            input: {}
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.output).toEqual({ custom: 'result' });
    });
});
