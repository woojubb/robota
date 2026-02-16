import { describe, expect, it } from 'vitest';
import {
    InMemoryStoragePort,
    type IDagDefinition,
    type IDagRun,
    type ITaskRun
} from '@robota-sdk/dag-core';
import { ProjectionReadModelService } from '../services/projection-read-model-service.js';

function createDefinition(): IDagDefinition {
    return {
        dagId: 'dag-projection',
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

function createRun(): IDagRun {
    return {
        dagRunId: 'run-projection-1',
        dagId: 'dag-projection',
        version: 1,
        status: 'running',
        runKey: 'dag-projection:2026-02-14T11:00:00.000Z',
        logicalDate: '2026-02-14T11:00:00.000Z',
        trigger: 'manual',
        startedAt: '2026-02-14T11:00:00.000Z'
    };
}

function createTaskRuns(): ITaskRun[] {
    return [
        {
            taskRunId: 'task-1',
            dagRunId: 'run-projection-1',
            nodeId: 'entry',
            status: 'success',
            attempt: 1
        },
        {
            taskRunId: 'task-2',
            dagRunId: 'run-projection-1',
            nodeId: 'next',
            status: 'running',
            attempt: 1
        }
    ];
}

describe('ProjectionReadModelService', () => {
    it('builds run projection with task status summary', async () => {
        const storage = new InMemoryStoragePort();
        await storage.saveDefinition(createDefinition());
        await storage.createDagRun(createRun());
        for (const taskRun of createTaskRuns()) {
            await storage.createTaskRun(taskRun);
        }

        const service = new ProjectionReadModelService(storage);
        const projection = await service.buildRunProjection('run-projection-1');

        expect(projection.ok).toBe(true);
        if (!projection.ok) {
            return;
        }
        expect(projection.value.taskRuns).toHaveLength(2);
        expect(projection.value.taskStatusSummary.success).toBe(1);
        expect(projection.value.taskStatusSummary.running).toBe(1);
    });

    it('builds lineage projection with node task statuses', async () => {
        const storage = new InMemoryStoragePort();
        await storage.saveDefinition(createDefinition());
        await storage.createDagRun(createRun());
        for (const taskRun of createTaskRuns()) {
            await storage.createTaskRun(taskRun);
        }

        const service = new ProjectionReadModelService(storage);
        const projection = await service.buildLineageProjection('run-projection-1');

        expect(projection.ok).toBe(true);
        if (!projection.ok) {
            return;
        }
        expect(projection.value.edges).toHaveLength(1);
        expect(projection.value.nodes.find((node) => node.nodeId === 'entry')?.taskStatus).toBe('success');
        expect(projection.value.nodes.find((node) => node.nodeId === 'next')?.taskStatus).toBe('running');
    });

    it('builds dashboard projection without additional caller orchestration', async () => {
        const storage = new InMemoryStoragePort();
        await storage.saveDefinition(createDefinition());
        await storage.createDagRun(createRun());
        for (const taskRun of createTaskRuns()) {
            await storage.createTaskRun(taskRun);
        }

        const service = new ProjectionReadModelService(storage);
        const projection = await service.buildDashboardProjection('run-projection-1');

        expect(projection.ok).toBe(true);
        if (!projection.ok) {
            return;
        }
        expect(projection.value.runProjection.dagRun.dagRunId).toBe('run-projection-1');
        expect(projection.value.lineageProjection.nodes).toHaveLength(2);
    });

    it('returns validation error when dagRun does not exist', async () => {
        const storage = new InMemoryStoragePort();
        const service = new ProjectionReadModelService(storage);
        const projection = await service.buildRunProjection('missing-run');

        expect(projection.ok).toBe(false);
        if (projection.ok) {
            return;
        }
        expect(projection.error.code).toBe('DAG_VALIDATION_DAG_RUN_NOT_FOUND');
    });
});
