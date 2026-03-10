import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DagRunService } from '../dag-run-service.js';
import type { IDagDefinition, IDagRun, ITaskRun, IStoragePort, IClockPort } from '@robota-sdk/dag-core';
import type { IDagExecutionComposition } from '@robota-sdk/dag-api';

function createMockStorage(): IStoragePort {
    return {
        saveDefinition: vi.fn().mockResolvedValue(undefined),
        getDefinition: vi.fn().mockResolvedValue(undefined),
        listDefinitions: vi.fn().mockResolvedValue([]),
        listDefinitionsByDagId: vi.fn().mockResolvedValue([]),
        getLatestPublishedDefinition: vi.fn().mockResolvedValue(undefined),
        deleteDefinition: vi.fn().mockResolvedValue(undefined),
        createDagRun: vi.fn().mockResolvedValue(undefined),
        getDagRun: vi.fn().mockResolvedValue(undefined),
        listDagRuns: vi.fn().mockResolvedValue([]),
        getDagRunByRunKey: vi.fn().mockResolvedValue(undefined),
        updateDagRunStatus: vi.fn().mockResolvedValue(undefined),
        deleteDagRun: vi.fn().mockResolvedValue(undefined),
        createTaskRun: vi.fn().mockResolvedValue(undefined),
        getTaskRun: vi.fn().mockResolvedValue(undefined),
        listTaskRunsByDagRunId: vi.fn().mockResolvedValue([]),
        deleteTaskRunsByDagRunId: vi.fn().mockResolvedValue(undefined),
        updateTaskRunStatus: vi.fn().mockResolvedValue(undefined),
        saveTaskRunSnapshots: vi.fn().mockResolvedValue(undefined),
        incrementTaskAttempt: vi.fn().mockResolvedValue(undefined)
    };
}

function createMockClock(): IClockPort {
    return {
        nowIso: vi.fn().mockReturnValue('2026-01-01T00:00:00.000Z'),
        nowEpochMs: vi.fn().mockReturnValue(1735689600000)
    };
}

function createMockExecution(): IDagExecutionComposition {
    return {
        runOrchestrator: {
            createRun: vi.fn().mockResolvedValue({ ok: true, value: { dagRunId: 'run-1' } }),
            startCreatedRun: vi.fn().mockResolvedValue({ ok: true, value: { dagRunId: 'run-1' } })
        },
        runQuery: {
            getRun: vi.fn().mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND', message: 'not found', category: 'validation', retryable: false } })
        },
        runCancel: {},
        workerLoop: {
            processOnce: vi.fn().mockResolvedValue({ ok: true, value: { processed: false } })
        },
        runProgressEventBus: {
            subscribe: vi.fn(),
            publish: vi.fn()
        }
    } as any;
}

function createSampleDefinition(): IDagDefinition {
    return {
        dagId: 'test-dag',
        version: 1,
        status: 'published',
        nodes: [
            {
                nodeId: 'node-1',
                nodeType: 'test-node',
                dependsOn: [],
                inputs: [],
                outputs: [],
                config: {}
            }
        ],
        edges: []
    };
}

function createSampleDagRun(overrides: Partial<IDagRun> = {}): IDagRun {
    return {
        dagRunId: 'run-1',
        dagId: 'test-dag',
        version: 1,
        status: 'success',
        runKey: 'run-key-1',
        logicalDate: '2026-01-01',
        trigger: 'manual',
        ...overrides
    };
}

function createSampleTaskRun(overrides: Partial<ITaskRun> = {}): ITaskRun {
    return {
        taskRunId: 'task-1',
        dagRunId: 'run-1',
        nodeId: 'node-1',
        status: 'success',
        attempt: 1,
        inputSnapshot: '{"key":"value"}',
        outputSnapshot: '{"result":"ok"}',
        estimatedCostUsd: 0.01,
        totalCostUsd: 0.02,
        ...overrides
    };
}

describe('DagRunService', () => {
    let storage: IStoragePort;
    let clock: IClockPort;
    let execution: IDagExecutionComposition;
    let service: DagRunService;

    beforeEach(() => {
        storage = createMockStorage();
        clock = createMockClock();
        execution = createMockExecution();
        service = new DagRunService({ storage, execution, clock });
    });

    describe('createRun', () => {
        it('creates a run copy definition, publishes it, and creates a run', async () => {
            const definition = createSampleDefinition();

            // createDraft calls getDefinition to check for duplicates (returns undefined -> no dup)
            // publish calls getDefinition to retrieve the saved draft
            // publish also calls listDefinitionsByDagId for version calculation
            let savedDraft: IDagDefinition | undefined;
            (storage.saveDefinition as any).mockImplementation((def: IDagDefinition) => {
                savedDraft = def;
                return Promise.resolve();
            });
            (storage.getDefinition as any).mockImplementation(() => {
                // First call: duplicate check returns undefined
                // Second call: publish retrieves the saved draft
                return Promise.resolve(savedDraft);
            });
            (storage.listDefinitionsByDagId as any).mockResolvedValue([]);

            const result = await service.createRun(definition, { prompt: 'hello' });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.dagRunId).toBe('run-1');
            }
            // Verify storage.saveDefinition was called (via DagDefinitionService.createDraft)
            expect(storage.saveDefinition).toHaveBeenCalled();
            const savedDef = (storage.saveDefinition as any).mock.calls[0][0] as IDagDefinition;
            expect(savedDef.dagId).toMatch(/^run-copy:test-dag:/);
            expect(savedDef.version).toBe(1);
            expect(savedDef.status).toBe('draft');
        });

        it('returns error when createDraft fails', async () => {
            // Make saveDefinition reject (simulating createDraft failure)
            // DagDefinitionService.createDraft calls getDefinition then saveDefinition
            // but it first checks if the definition already exists
            (storage.getDefinition as any).mockResolvedValue(createSampleDefinition());
            // When definition already exists, createDraft returns a validation error

            const definition = createSampleDefinition();
            const result = await service.createRun(definition, {});

            // Since the run-copy has a unique dagId (with timestamp), getDefinition returning
            // a value means the definition "already exists" => createDraft returns error
            expect(result.ok).toBe(false);
        });

        it('returns error when publish fails', async () => {
            // createDraft succeeds (definition doesn't exist yet)
            (storage.getDefinition as any).mockResolvedValueOnce(undefined);
            // For publish: getDefinition returns the draft
            (storage.getDefinition as any).mockResolvedValueOnce({
                ...createSampleDefinition(),
                dagId: 'run-copy:test-dag:123:456',
                version: 1,
                status: 'draft'
            });
            // Publish requires a 'draft' status - this should work, but let's have
            // the orchestrator createRun fail instead to test that branch
            (execution.runOrchestrator.createRun as any).mockResolvedValue({
                ok: false,
                error: { code: 'CREATE_FAILED', message: 'failed', category: 'validation', retryable: false }
            });

            const definition = createSampleDefinition();
            const result = await service.createRun(definition, {});

            expect(result.ok).toBe(false);
        });
    });

    describe('startRunById', () => {
        it('starts a run and returns the dagRunId', async () => {
            const result = await service.startRunById('run-1');

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.dagRunId).toBe('run-1');
            }
            expect(execution.runOrchestrator.startCreatedRun).toHaveBeenCalledWith('run-1');
        });

        it('returns error when startCreatedRun fails', async () => {
            (execution.runOrchestrator.startCreatedRun as any).mockResolvedValue({
                ok: false,
                error: { code: 'START_FAILED', message: 'failed', category: 'validation', retryable: false }
            });

            const result = await service.startRunById('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('START_FAILED');
            }
        });
    });

    describe('getRunResult', () => {
        it('returns error when run query fails', async () => {
            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
        });

        it('returns error when run is not terminal', async () => {
            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: {
                    dagRun: createSampleDagRun({ status: 'running' }),
                    taskRuns: []
                }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_RUN_NOT_TERMINAL');
            }
        });

        it('returns run result for successful run with traces', async () => {
            const definition = createSampleDefinition();
            const dagRun = createSampleDagRun({
                status: 'success',
                definitionSnapshot: JSON.stringify(definition)
            });
            const taskRun = createSampleTaskRun();

            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: { dagRun, taskRuns: [taskRun] }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.dagRunId).toBe('run-1');
                expect(result.value.traces).toHaveLength(1);
                expect(result.value.traces[0].nodeId).toBe('node-1');
                expect(result.value.traces[0].nodeType).toBe('test-node');
                expect(result.value.traces[0].estimatedCostUsd).toBe(0.01);
                expect(result.value.traces[0].totalCostUsd).toBe(0.02);
                expect(result.value.totalCostUsd).toBe(0.02);
            }
        });

        it('returns error when definition snapshot is missing', async () => {
            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: {
                    dagRun: createSampleDagRun({ status: 'success', definitionSnapshot: undefined }),
                    taskRuns: [createSampleTaskRun()]
                }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_DEFINITION_SNAPSHOT_MISSING');
            }
        });

        it('returns error when definition snapshot is invalid JSON', async () => {
            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: {
                    dagRun: createSampleDagRun({ status: 'success', definitionSnapshot: 'not-json' }),
                    taskRuns: [createSampleTaskRun()]
                }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_DEFINITION_SNAPSHOT_PARSE_FAILED');
            }
        });

        it('returns error when definition snapshot is not an object', async () => {
            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: {
                    dagRun: createSampleDagRun({ status: 'success', definitionSnapshot: '"string"' }),
                    taskRuns: [createSampleTaskRun()]
                }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID');
            }
        });

        it('returns error when definition snapshot is an array', async () => {
            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: {
                    dagRun: createSampleDagRun({ status: 'success', definitionSnapshot: '[]' }),
                    taskRuns: [createSampleTaskRun()]
                }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID');
            }
        });

        it('returns error when definition snapshot is null', async () => {
            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: {
                    dagRun: createSampleDagRun({ status: 'success', definitionSnapshot: 'null' }),
                    taskRuns: [createSampleTaskRun()]
                }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID');
            }
        });

        it('returns error when node type is not found in definition', async () => {
            const definition = createSampleDefinition();
            const dagRun = createSampleDagRun({
                status: 'success',
                definitionSnapshot: JSON.stringify(definition)
            });
            const taskRun = createSampleTaskRun({ nodeId: 'unknown-node' });

            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: { dagRun, taskRuns: [taskRun] }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_RUN_TRACE_NODE_TYPE_NOT_FOUND');
            }
        });

        it('returns error when task run snapshots are missing', async () => {
            const definition = createSampleDefinition();
            const dagRun = createSampleDagRun({
                status: 'success',
                definitionSnapshot: JSON.stringify(definition)
            });
            const taskRun = createSampleTaskRun({
                inputSnapshot: undefined,
                outputSnapshot: undefined
            });

            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: { dagRun, taskRuns: [taskRun] }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_RUN_TRACE_SNAPSHOT_MISSING');
            }
        });

        it('returns error when input snapshot has invalid shape', async () => {
            const definition = createSampleDefinition();
            const dagRun = createSampleDagRun({
                status: 'success',
                definitionSnapshot: JSON.stringify(definition)
            });
            const taskRun = createSampleTaskRun({
                inputSnapshot: '"not-an-object"',
                outputSnapshot: '{"result":"ok"}'
            });

            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: { dagRun, taskRuns: [taskRun] }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_RUN_TRACE_SNAPSHOT_INVALID');
            }
        });

        it('returns error when input snapshot is unparseable', async () => {
            const definition = createSampleDefinition();
            const dagRun = createSampleDagRun({
                status: 'success',
                definitionSnapshot: JSON.stringify(definition)
            });
            const taskRun = createSampleTaskRun({
                inputSnapshot: 'not-json{',
                outputSnapshot: '{"result":"ok"}'
            });

            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: { dagRun, taskRuns: [taskRun] }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_RUN_TRACE_SNAPSHOT_PARSE_FAILED');
            }
        });

        it('returns error when output snapshot has invalid shape', async () => {
            const definition = createSampleDefinition();
            const dagRun = createSampleDagRun({
                status: 'success',
                definitionSnapshot: JSON.stringify(definition)
            });
            const taskRun = createSampleTaskRun({
                inputSnapshot: '{"key":"value"}',
                outputSnapshot: '[]'
            });

            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: { dagRun, taskRuns: [taskRun] }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_RUN_TRACE_SNAPSHOT_INVALID');
            }
        });

        it('returns error when cost fields are missing', async () => {
            const definition = createSampleDefinition();
            const dagRun = createSampleDagRun({
                status: 'success',
                definitionSnapshot: JSON.stringify(definition)
            });
            const taskRun = createSampleTaskRun({
                estimatedCostUsd: undefined,
                totalCostUsd: undefined
            });

            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: { dagRun, taskRuns: [taskRun] }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_RUN_TRACE_COST_MISSING');
            }
        });

        it('sorts traces by node order in definition then by taskRunId', async () => {
            const definition: IDagDefinition = {
                dagId: 'test-dag',
                version: 1,
                status: 'published',
                nodes: [
                    { nodeId: 'node-a', nodeType: 'type-a', dependsOn: [], inputs: [], outputs: [], config: {} },
                    { nodeId: 'node-b', nodeType: 'type-b', dependsOn: [], inputs: [], outputs: [], config: {} }
                ],
                edges: []
            };
            const dagRun = createSampleDagRun({
                status: 'success',
                definitionSnapshot: JSON.stringify(definition)
            });
            const taskRunB = createSampleTaskRun({ taskRunId: 'task-b', nodeId: 'node-b' });
            const taskRunA = createSampleTaskRun({ taskRunId: 'task-a', nodeId: 'node-a' });

            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: { dagRun, taskRuns: [taskRunB, taskRunA] }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.traces[0].nodeId).toBe('node-a');
                expect(result.value.traces[1].nodeId).toBe('node-b');
            }
        });

        it('handles failed run - returns error from failed task run', async () => {
            const dagRun = createSampleDagRun({ status: 'failed' });
            const failedTaskRun = createSampleTaskRun({
                status: 'failed',
                errorCode: 'TASK_ERROR',
                errorMessage: 'task execution error'
            });

            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: { dagRun, taskRuns: [failedTaskRun] }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('TASK_ERROR');
                expect(result.error.message).toBe('task execution error');
            }
        });

        it('handles failed run - upstream_failed task', async () => {
            const dagRun = createSampleDagRun({ status: 'failed' });
            const failedTaskRun = createSampleTaskRun({
                status: 'upstream_failed',
                errorCode: 'UPSTREAM_ERR',
                errorMessage: 'upstream failed'
            });

            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: { dagRun, taskRuns: [failedTaskRun] }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('UPSTREAM_ERR');
            }
        });

        it('handles failed run - cancelled task', async () => {
            const dagRun = createSampleDagRun({ status: 'cancelled' });
            const cancelledTaskRun = createSampleTaskRun({
                status: 'cancelled',
                errorCode: 'CANCELLED',
                errorMessage: 'task cancelled'
            });

            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: { dagRun, taskRuns: [cancelledTaskRun] }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('CANCELLED');
            }
        });

        it('returns error when failed run has no failed task run', async () => {
            const dagRun = createSampleDagRun({ status: 'failed' });
            const successTaskRun = createSampleTaskRun({ status: 'success' });

            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: { dagRun, taskRuns: [successTaskRun] }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_RUN_FAILED_WITHOUT_TASK');
            }
        });

        it('returns error when failed task is missing error details', async () => {
            const dagRun = createSampleDagRun({ status: 'failed' });
            const failedTaskRun = createSampleTaskRun({
                status: 'failed',
                errorCode: undefined,
                errorMessage: undefined
            });

            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: { dagRun, taskRuns: [failedTaskRun] }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_RUN_FAILURE_DETAILS_MISSING');
            }
        });

        it('skips non-successful task runs in trace mapping', async () => {
            const definition = createSampleDefinition();
            const dagRun = createSampleDagRun({
                status: 'success',
                definitionSnapshot: JSON.stringify(definition)
            });
            const successTask = createSampleTaskRun({ taskRunId: 'task-1', status: 'success' });
            const failedTask = createSampleTaskRun({ taskRunId: 'task-2', status: 'failed' });

            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: { dagRun, taskRuns: [successTask, failedTask] }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.traces).toHaveLength(1);
            }
        });

        it('returns empty snapshot string error (trimmed empty)', async () => {
            (execution.runQuery.getRun as any).mockResolvedValue({
                ok: true,
                value: {
                    dagRun: createSampleDagRun({ status: 'success', definitionSnapshot: '   ' }),
                    taskRuns: [createSampleTaskRun()]
                }
            });

            const result = await service.getRunResult('run-1');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_DEFINITION_SNAPSHOT_MISSING');
            }
        });
    });

    describe('deleteRunArtifacts', () => {
        it('deletes run and task run artifacts', async () => {
            const dagRun = createSampleDagRun();
            const taskRuns = [createSampleTaskRun(), createSampleTaskRun({ taskRunId: 'task-2' })];
            (storage.getDagRun as any).mockResolvedValue(dagRun);
            (storage.listTaskRunsByDagRunId as any).mockResolvedValue(taskRuns);

            const result = await service.deleteRunArtifacts('run-1');

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.deletedTaskRunCount).toBe(2);
            }
            expect(storage.deleteTaskRunsByDagRunId).toHaveBeenCalledWith('run-1');
            expect(storage.deleteDagRun).toHaveBeenCalledWith('run-1');
        });

        it('returns error when run is not found', async () => {
            (storage.getDagRun as any).mockResolvedValue(undefined);

            const result = await service.deleteRunArtifacts('unknown-run');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_DAG_RUN_NOT_FOUND');
            }
        });
    });

    describe('deleteDefinitionArtifacts', () => {
        it('deletes all definitions and their runs for a dagId', async () => {
            const definitions = [
                createSampleDefinition(),
                { ...createSampleDefinition(), version: 2 }
            ];
            const dagRuns = [createSampleDagRun()];
            const taskRuns = [createSampleTaskRun()];

            (storage.listDefinitionsByDagId as any).mockResolvedValue(definitions);
            (storage.listDagRuns as any).mockResolvedValue(dagRuns);
            (storage.listTaskRunsByDagRunId as any).mockResolvedValue(taskRuns);

            const result = await service.deleteDefinitionArtifacts('test-dag');

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.deletedDefinitionCount).toBe(2);
                expect(result.value.deletedDagRunCount).toBe(1);
                expect(result.value.deletedTaskRunCount).toBe(1);
            }
        });

        it('deletes a specific version only', async () => {
            const definitions = [
                createSampleDefinition(),
                { ...createSampleDefinition(), version: 2 }
            ];
            (storage.listDefinitionsByDagId as any).mockResolvedValue(definitions);
            (storage.listDagRuns as any).mockResolvedValue([]);

            const result = await service.deleteDefinitionArtifacts('test-dag', 1);

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.deletedDefinitionCount).toBe(1);
            }
        });

        it('returns error when no definitions found', async () => {
            (storage.listDefinitionsByDagId as any).mockResolvedValue([]);

            const result = await service.deleteDefinitionArtifacts('unknown-dag');

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_DEFINITION_NOT_FOUND');
            }
        });

        it('returns error when specific version not found', async () => {
            (storage.listDefinitionsByDagId as any).mockResolvedValue([createSampleDefinition()]);

            const result = await service.deleteDefinitionArtifacts('test-dag', 999);

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_DEFINITION_NOT_FOUND');
            }
        });
    });

    describe('deleteRunCopyArtifacts', () => {
        it('deletes run-copy definitions and their runs', async () => {
            const runCopyDef: IDagDefinition = {
                dagId: 'run-copy:test-dag:123:456',
                version: 1,
                status: 'published',
                nodes: [],
                edges: []
            };
            const dagRun = createSampleDagRun({
                dagId: 'run-copy:test-dag:123:456',
                version: 1
            });

            (storage.listDefinitions as any).mockResolvedValue([runCopyDef, createSampleDefinition()]);
            (storage.listDagRuns as any).mockResolvedValue([dagRun]);
            (storage.listTaskRunsByDagRunId as any).mockResolvedValue([]);

            const result = await service.deleteRunCopyArtifacts();

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.deletedDefinitionCount).toBe(1);
                expect(result.value.deletedDagRunCount).toBe(1);
            }
        });

        it('returns zero counts when no run-copy definitions exist', async () => {
            (storage.listDefinitions as any).mockResolvedValue([createSampleDefinition()]);

            const result = await service.deleteRunCopyArtifacts();

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.deletedDefinitionCount).toBe(0);
                expect(result.value.deletedDagRunCount).toBe(0);
                expect(result.value.deletedTaskRunCount).toBe(0);
            }
        });
    });
});
