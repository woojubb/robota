import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { FileStoragePort } from '../file-storage-port.js';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { IDagDefinition, IDagRun, ITaskRun } from '@robota-sdk/dag-core';

function createSampleDefinition(dagId: string, version: number, status: 'draft' | 'published' = 'draft'): IDagDefinition {
    return {
        dagId,
        version,
        status,
        nodes: [],
        edges: []
    };
}

function createSampleDagRun(dagRunId: string, dagId: string, version: number): IDagRun {
    return {
        dagRunId,
        dagId,
        version,
        status: 'created',
        runKey: `key-${dagRunId}`,
        logicalDate: '2026-01-01',
        trigger: 'manual'
    };
}

function createSampleTaskRun(taskRunId: string, dagRunId: string, nodeId: string): ITaskRun {
    return {
        taskRunId,
        dagRunId,
        nodeId,
        status: 'created',
        attempt: 1
    };
}

describe('FileStoragePort', () => {
    let tmpDir: string;
    let storage: FileStoragePort;

    beforeEach(async () => {
        tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dag-fs-test-'));
        storage = new FileStoragePort(tmpDir);
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    describe('definition operations', () => {
        it('saves and retrieves a definition', async () => {
            const def = createSampleDefinition('dag-1', 1);
            await storage.saveDefinition(def);

            const retrieved = await storage.getDefinition('dag-1', 1);
            expect(retrieved).toEqual(def);
        });

        it('returns undefined for non-existent definition', async () => {
            const retrieved = await storage.getDefinition('no-exist', 1);
            expect(retrieved).toBeUndefined();
        });

        it('lists all definitions sorted by dagId and version', async () => {
            await storage.saveDefinition(createSampleDefinition('dag-b', 1));
            await storage.saveDefinition(createSampleDefinition('dag-a', 2));
            await storage.saveDefinition(createSampleDefinition('dag-a', 1));

            const definitions = await storage.listDefinitions();
            expect(definitions).toHaveLength(3);
            expect(definitions[0].dagId).toBe('dag-a');
            expect(definitions[0].version).toBe(1);
            expect(definitions[1].dagId).toBe('dag-a');
            expect(definitions[1].version).toBe(2);
            expect(definitions[2].dagId).toBe('dag-b');
        });

        it('lists definitions by dagId sorted by version', async () => {
            await storage.saveDefinition(createSampleDefinition('dag-1', 3));
            await storage.saveDefinition(createSampleDefinition('dag-1', 1));
            await storage.saveDefinition(createSampleDefinition('dag-2', 1));

            const definitions = await storage.listDefinitionsByDagId('dag-1');
            expect(definitions).toHaveLength(2);
            expect(definitions[0].version).toBe(1);
            expect(definitions[1].version).toBe(3);
        });

        it('returns empty array for non-existent dagId in listDefinitionsByDagId', async () => {
            const definitions = await storage.listDefinitionsByDagId('no-exist');
            expect(definitions).toEqual([]);
        });

        it('gets latest published definition', async () => {
            await storage.saveDefinition(createSampleDefinition('dag-1', 1, 'published'));
            await storage.saveDefinition(createSampleDefinition('dag-1', 2, 'published'));
            await storage.saveDefinition(createSampleDefinition('dag-1', 3, 'draft'));

            const latest = await storage.getLatestPublishedDefinition('dag-1');
            expect(latest).toBeDefined();
            expect(latest!.version).toBe(2);
        });

        it('returns undefined when no published definitions exist', async () => {
            await storage.saveDefinition(createSampleDefinition('dag-1', 1, 'draft'));

            const latest = await storage.getLatestPublishedDefinition('dag-1');
            expect(latest).toBeUndefined();
        });

        it('deletes a definition', async () => {
            await storage.saveDefinition(createSampleDefinition('dag-1', 1));
            await storage.saveDefinition(createSampleDefinition('dag-1', 2));

            await storage.deleteDefinition('dag-1', 1);

            const retrieved = await storage.getDefinition('dag-1', 1);
            expect(retrieved).toBeUndefined();
            const remaining = await storage.listDefinitionsByDagId('dag-1');
            expect(remaining).toHaveLength(1);
        });

        it('cleans up directory when last definition is deleted', async () => {
            await storage.saveDefinition(createSampleDefinition('dag-cleanup', 1));
            await storage.deleteDefinition('dag-cleanup', 1);

            const definitions = await storage.listDefinitionsByDagId('dag-cleanup');
            expect(definitions).toEqual([]);
        });

        it('handles dagId with special characters', async () => {
            const dagId = 'run-copy:dag-1:123:456';
            await storage.saveDefinition(createSampleDefinition(dagId, 1));

            const retrieved = await storage.getDefinition(dagId, 1);
            expect(retrieved).toBeDefined();
            expect(retrieved!.dagId).toBe(dagId);
        });
    });

    describe('dag run operations (in-memory)', () => {
        it('creates and retrieves a dag run', async () => {
            const dagRun = createSampleDagRun('run-1', 'dag-1', 1);
            await storage.createDagRun(dagRun);

            const retrieved = await storage.getDagRun('run-1');
            expect(retrieved).toEqual(dagRun);
        });

        it('returns undefined for non-existent dag run', async () => {
            const retrieved = await storage.getDagRun('no-run');
            expect(retrieved).toBeUndefined();
        });

        it('lists dag runs sorted by dagRunId', async () => {
            await storage.createDagRun(createSampleDagRun('run-b', 'dag-1', 1));
            await storage.createDagRun(createSampleDagRun('run-a', 'dag-1', 1));

            const runs = await storage.listDagRuns();
            expect(runs).toHaveLength(2);
            expect(runs[0].dagRunId).toBe('run-a');
            expect(runs[1].dagRunId).toBe('run-b');
        });

        it('gets dag run by run key', async () => {
            const dagRun = createSampleDagRun('run-1', 'dag-1', 1);
            await storage.createDagRun(dagRun);

            const retrieved = await storage.getDagRunByRunKey('key-run-1');
            expect(retrieved).toEqual(dagRun);
        });

        it('returns undefined for non-existent run key', async () => {
            const retrieved = await storage.getDagRunByRunKey('no-key');
            expect(retrieved).toBeUndefined();
        });

        it('updates dag run status', async () => {
            await storage.createDagRun(createSampleDagRun('run-1', 'dag-1', 1));
            await storage.updateDagRunStatus('run-1', 'running');

            const retrieved = await storage.getDagRun('run-1');
            expect(retrieved!.status).toBe('running');
        });

        it('updates dag run status with endedAt', async () => {
            await storage.createDagRun(createSampleDagRun('run-1', 'dag-1', 1));
            await storage.updateDagRunStatus('run-1', 'success', '2026-01-01T12:00:00.000Z');

            const retrieved = await storage.getDagRun('run-1');
            expect(retrieved!.status).toBe('success');
            expect(retrieved!.endedAt).toBe('2026-01-01T12:00:00.000Z');
        });

        it('does nothing when updating non-existent dag run status', async () => {
            await storage.updateDagRunStatus('no-run', 'failed');
            // Should not throw
        });

        it('deletes a dag run', async () => {
            await storage.createDagRun(createSampleDagRun('run-1', 'dag-1', 1));
            await storage.deleteDagRun('run-1');

            const retrieved = await storage.getDagRun('run-1');
            expect(retrieved).toBeUndefined();
        });
    });

    describe('task run operations (in-memory)', () => {
        it('creates and retrieves a task run', async () => {
            const taskRun = createSampleTaskRun('task-1', 'run-1', 'node-1');
            await storage.createTaskRun(taskRun);

            const retrieved = await storage.getTaskRun('task-1');
            expect(retrieved).toEqual(taskRun);
        });

        it('returns undefined for non-existent task run', async () => {
            const retrieved = await storage.getTaskRun('no-task');
            expect(retrieved).toBeUndefined();
        });

        it('lists task runs by dag run id', async () => {
            await storage.createTaskRun(createSampleTaskRun('task-1', 'run-1', 'node-1'));
            await storage.createTaskRun(createSampleTaskRun('task-2', 'run-1', 'node-2'));
            await storage.createTaskRun(createSampleTaskRun('task-3', 'run-2', 'node-1'));

            const tasks = await storage.listTaskRunsByDagRunId('run-1');
            expect(tasks).toHaveLength(2);
        });

        it('deletes task runs by dag run id', async () => {
            await storage.createTaskRun(createSampleTaskRun('task-1', 'run-1', 'node-1'));
            await storage.createTaskRun(createSampleTaskRun('task-2', 'run-1', 'node-2'));
            await storage.createTaskRun(createSampleTaskRun('task-3', 'run-2', 'node-1'));

            await storage.deleteTaskRunsByDagRunId('run-1');

            const remaining = await storage.listTaskRunsByDagRunId('run-1');
            expect(remaining).toHaveLength(0);
            const otherRun = await storage.listTaskRunsByDagRunId('run-2');
            expect(otherRun).toHaveLength(1);
        });

        it('updates task run status', async () => {
            await storage.createTaskRun(createSampleTaskRun('task-1', 'run-1', 'node-1'));
            await storage.updateTaskRunStatus('task-1', 'running');

            const retrieved = await storage.getTaskRun('task-1');
            expect(retrieved!.status).toBe('running');
        });

        it('updates task run status with error', async () => {
            await storage.createTaskRun(createSampleTaskRun('task-1', 'run-1', 'node-1'));
            await storage.updateTaskRunStatus('task-1', 'failed', {
                code: 'EXEC_FAILED',
                message: 'execution failed',
                category: 'task_execution',
                retryable: false
            });

            const retrieved = await storage.getTaskRun('task-1');
            expect(retrieved!.status).toBe('failed');
            expect(retrieved!.errorCode).toBe('EXEC_FAILED');
            expect(retrieved!.errorMessage).toBe('execution failed');
        });

        it('does nothing when updating non-existent task run status', async () => {
            await storage.updateTaskRunStatus('no-task', 'failed');
            // Should not throw
        });

        it('saves task run snapshots', async () => {
            await storage.createTaskRun(createSampleTaskRun('task-1', 'run-1', 'node-1'));
            await storage.saveTaskRunSnapshots('task-1', '{"in":"data"}', '{"out":"data"}', 0.01, 0.02);

            const retrieved = await storage.getTaskRun('task-1');
            expect(retrieved!.inputSnapshot).toBe('{"in":"data"}');
            expect(retrieved!.outputSnapshot).toBe('{"out":"data"}');
            expect(retrieved!.estimatedCostUsd).toBe(0.01);
            expect(retrieved!.totalCostUsd).toBe(0.02);
        });

        it('preserves existing snapshots when undefined is passed', async () => {
            await storage.createTaskRun(createSampleTaskRun('task-1', 'run-1', 'node-1'));
            await storage.saveTaskRunSnapshots('task-1', '{"in":"data"}', '{"out":"data"}', 0.01, 0.02);
            await storage.saveTaskRunSnapshots('task-1', undefined, undefined, undefined, undefined);

            const retrieved = await storage.getTaskRun('task-1');
            expect(retrieved!.inputSnapshot).toBe('{"in":"data"}');
            expect(retrieved!.outputSnapshot).toBe('{"out":"data"}');
            expect(retrieved!.estimatedCostUsd).toBe(0.01);
            expect(retrieved!.totalCostUsd).toBe(0.02);
        });

        it('does nothing when saving snapshots for non-existent task run', async () => {
            await storage.saveTaskRunSnapshots('no-task', '{}', '{}', 0, 0);
            // Should not throw
        });

        it('increments task attempt', async () => {
            await storage.createTaskRun(createSampleTaskRun('task-1', 'run-1', 'node-1'));
            await storage.incrementTaskAttempt('task-1');

            const retrieved = await storage.getTaskRun('task-1');
            expect(retrieved!.attempt).toBe(2);
        });

        it('does nothing when incrementing non-existent task run attempt', async () => {
            await storage.incrementTaskAttempt('no-task');
            // Should not throw
        });
    });
});
