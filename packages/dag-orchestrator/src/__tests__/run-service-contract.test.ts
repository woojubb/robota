import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrchestratorRunService } from '../services/orchestrator-run-service.js';
import type { IPromptApiClientPort } from '../interfaces/prompt-api-client-port.js';
import type {
    IDagDefinition,
    TRunProgressEvent,
    IDagError,
} from '@robota-sdk/dag-core';

const MOCK_PROMPT_ID = 'runtime-prompt-id-abc';

function createMockPromptClient(
    overrides: Partial<IPromptApiClientPort> = {}
): IPromptApiClientPort {
    return {
        submitPrompt: vi.fn(async () => ({
            ok: true as const,
            value: { prompt_id: MOCK_PROMPT_ID, number: 1, node_errors: {} },
        })),
        getQueue: vi.fn(async () => ({
            ok: true as const,
            value: { queue_running: [], queue_pending: [] },
        })),
        manageQueue: vi.fn(async () => ({ ok: true as const, value: undefined })),
        getHistory: vi.fn(async () => ({ ok: true as const, value: {} })),
        getObjectInfo: vi.fn(async () => ({ ok: true as const, value: {} })),
        getSystemStats: vi.fn(async () => ({
            ok: true as const,
            value: {
                system: { os: 'test', runtime_version: '1.0', embedded_python: false },
                devices: [],
            },
        })),
        ...overrides,
    };
}

function makeDefinition(): IDagDefinition {
    return {
        dagId: 'test-dag',
        version: 1,
        status: 'published',
        nodes: [
            {
                nodeId: 'node1',
                nodeType: 'TestNode',
                dependsOn: [],
                config: { value: 'test' },
                inputs: [],
                outputs: [],
            },
        ],
        edges: [],
    };
}

function makeEvent(
    eventType: TRunProgressEvent['eventType'],
    extra: Record<string, unknown> = {}
): TRunProgressEvent {
    const base = {
        dagRunId: MOCK_PROMPT_ID,
        occurredAt: new Date().toISOString(),
    };

    switch (eventType) {
        case 'execution.started':
            return { ...base, eventType, dagId: 'test-dag', version: 1, ...extra } as TRunProgressEvent;
        case 'execution.completed':
            return { ...base, eventType, ...extra } as TRunProgressEvent;
        case 'execution.failed':
            return {
                ...base,
                eventType,
                error: { category: 'execution', code: 'FAIL', message: 'failed', context: {} },
                ...extra,
            } as TRunProgressEvent;
        case 'task.started':
        case 'task.completed':
            return {
                ...base,
                eventType,
                taskRunId: 'task-1',
                nodeId: 'node1',
                ...extra,
            } as TRunProgressEvent;
        case 'task.failed':
            return {
                ...base,
                eventType,
                taskRunId: 'task-1',
                nodeId: 'node1',
                error: { category: 'execution', code: 'NODE_FAIL', message: 'node failed', context: {} },
                ...extra,
            } as TRunProgressEvent;
        default:
            return { ...base, eventType } as TRunProgressEvent;
    }
}

describe('OrchestratorRunService', () => {
    let service: OrchestratorRunService;
    let mockClient: IPromptApiClientPort;

    beforeEach(() => {
        mockClient = createMockPromptClient();
        service = new OrchestratorRunService(mockClient);
    });

    describe('createRun', () => {
        it('stores run state and returns preparationId', async () => {
            const result = await service.createRun(makeDefinition(), {});
            expect(result.ok).toBe(true);
            if (!result.ok) return;

            expect(result.value.preparationId).toBeDefined();
            expect(typeof result.value.preparationId).toBe('string');
        });

        it('returns error for empty definition', async () => {
            const emptyDef: IDagDefinition = {
                dagId: 'empty',
                version: 1,
                status: 'published',
                nodes: [],
                edges: [],
            };
            const result = await service.createRun(emptyDef, {});
            expect(result.ok).toBe(false);
        });
    });

    describe('startRun', () => {
        it('calls promptClient.submitPrompt and returns dagRunId = promptId', async () => {
            const createResult = await service.createRun(makeDefinition(), {});
            if (!createResult.ok) throw new Error('createRun failed');

            const startResult = await service.startRun(createResult.value.preparationId);
            expect(startResult.ok).toBe(true);
            if (!startResult.ok) return;

            expect(startResult.value.dagRunId).toBe(MOCK_PROMPT_ID);
            expect(startResult.value.preparationId).toBe(createResult.value.preparationId);
            expect(mockClient.submitPrompt).toHaveBeenCalledOnce();
        });

        it('dagRunId equals the promptId from runtime, not the preparation key', async () => {
            const createResult = await service.createRun(makeDefinition(), {});
            if (!createResult.ok) throw new Error('createRun failed');

            const preparationId = createResult.value.preparationId;
            const startResult = await service.startRun(preparationId);
            if (!startResult.ok) throw new Error('startRun failed');

            // dagRunId must be the runtime promptId, NOT the preparationId
            expect(startResult.value.dagRunId).toBe(MOCK_PROMPT_ID);
            expect(startResult.value.dagRunId).not.toBe(preparationId);
        });

        it('returns error for unknown preparationId', async () => {
            const result = await service.startRun('nonexistent');
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('ORCHESTRATOR_RUN_NOT_FOUND');
        });

        it('returns error if run already started', async () => {
            const createResult = await service.createRun(makeDefinition(), {});
            if (!createResult.ok) throw new Error('createRun failed');

            await service.startRun(createResult.value.preparationId);
            const secondStart = await service.startRun(createResult.value.preparationId);
            expect(secondStart.ok).toBe(false);
            if (secondStart.ok) return;
            expect(secondStart.error.code).toBe('ORCHESTRATOR_RUN_ALREADY_STARTED');
        });
    });

    describe('recordEvent', () => {
        it('accumulates events; execution.completed sets status to success', async () => {
            const createResult = await service.createRun(makeDefinition(), {});
            if (!createResult.ok) throw new Error('createRun failed');

            const startResult = await service.startRun(createResult.value.preparationId);
            if (!startResult.ok) throw new Error('startRun failed');

            const dagRunId = startResult.value.dagRunId;

            service.recordEvent(dagRunId, makeEvent('task.started'));
            service.recordEvent(dagRunId, makeEvent('task.completed'));
            service.recordEvent(dagRunId, makeEvent('execution.completed'));

            // After execution.completed, getRunStatus should reflect success
            // (Mock getHistory to return matching entry so status check works)
            const statusResult = await service.getRunStatus(dagRunId);
            expect(statusResult.ok).toBe(true);
            if (!statusResult.ok) return;
            expect(statusResult.value.status).toBe('success');
        });

        it('execution.failed sets status to failed', async () => {
            const createResult = await service.createRun(makeDefinition(), {});
            if (!createResult.ok) throw new Error('createRun failed');

            const startResult = await service.startRun(createResult.value.preparationId);
            if (!startResult.ok) throw new Error('startRun failed');

            const dagRunId = startResult.value.dagRunId;

            service.recordEvent(dagRunId, makeEvent('execution.failed'));

            const statusResult = await service.getRunStatus(dagRunId);
            expect(statusResult.ok).toBe(true);
            if (!statusResult.ok) return;
            expect(statusResult.value.status).toBe('failed');
        });
    });

    describe('getRunResult', () => {
        it('returns success result for successful run', async () => {
            const successHistory = {
                [MOCK_PROMPT_ID]: {
                    prompt: {},
                    outputs: {},
                    status: { status_str: 'success' as const, completed: true, messages: [] },
                },
            };
            mockClient = createMockPromptClient({
                getHistory: vi.fn(async () => ({ ok: true as const, value: successHistory })),
            });
            service = new OrchestratorRunService(mockClient);

            const createResult = await service.createRun(makeDefinition(), {});
            if (!createResult.ok) throw new Error('createRun failed');
            const startResult = await service.startRun(createResult.value.preparationId);
            if (!startResult.ok) throw new Error('startRun failed');

            const result = await service.getRunResult(startResult.value.dagRunId);
            expect(result.ok).toBe(true);
            if (!result.ok) return;

            expect(result.value.status).toBe('success');
            expect(result.value.nodeErrors).toEqual([]);
            expect(result.value.dagRunId).toBe(MOCK_PROMPT_ID);
        });

        it('returns failed result with node errors for failed run', async () => {
            const failedHistory = {
                [MOCK_PROMPT_ID]: {
                    prompt: {},
                    outputs: {},
                    status: { status_str: 'error' as const, completed: true, messages: [] },
                },
            };
            mockClient = createMockPromptClient({
                getHistory: vi.fn(async () => ({ ok: true as const, value: failedHistory })),
            });
            service = new OrchestratorRunService(mockClient);

            const createResult = await service.createRun(makeDefinition(), {});
            if (!createResult.ok) throw new Error('createRun failed');
            const startResult = await service.startRun(createResult.value.preparationId);
            if (!startResult.ok) throw new Error('startRun failed');

            // Record a task failure event
            service.recordEvent(startResult.value.dagRunId, makeEvent('task.failed'));

            const result = await service.getRunResult(startResult.value.dagRunId);
            expect(result.ok).toBe(true);
            if (!result.ok) return;

            expect(result.value.status).toBe('failed');
            expect(result.value.nodeErrors.length).toBeGreaterThan(0);
            expect(result.value.nodeErrors[0].nodeId).toBe('node1');
            expect(result.value.dagRunId).toBe(MOCK_PROMPT_ID);
        });
    });

    describe('getDagRunId', () => {
        it('returns undefined before startRun', async () => {
            const createResult = await service.createRun(makeDefinition(), {});
            if (!createResult.ok) throw new Error('createRun failed');

            const dagRunId = service.getDagRunId(createResult.value.preparationId);
            expect(dagRunId).toBeUndefined();
        });

        it('returns promptId after startRun', async () => {
            const createResult = await service.createRun(makeDefinition(), {});
            if (!createResult.ok) throw new Error('createRun failed');

            await service.startRun(createResult.value.preparationId);

            const dagRunId = service.getDagRunId(createResult.value.preparationId);
            expect(dagRunId).toBe(MOCK_PROMPT_ID);
        });
    });

    describe('lookup by both preparationId and dagRunId', () => {
        it('getRunStatus works with dagRunId (= promptId)', async () => {
            const createResult = await service.createRun(makeDefinition(), {});
            if (!createResult.ok) throw new Error('createRun failed');
            const startResult = await service.startRun(createResult.value.preparationId);
            if (!startResult.ok) throw new Error('startRun failed');

            const statusResult = await service.getRunStatus(startResult.value.dagRunId);
            expect(statusResult.ok).toBe(true);
            if (!statusResult.ok) return;
            expect(statusResult.value.status).toBe('running');
        });

        it('getRunStatus works with preparationId', async () => {
            const createResult = await service.createRun(makeDefinition(), {});
            if (!createResult.ok) throw new Error('createRun failed');
            const startResult = await service.startRun(createResult.value.preparationId);
            if (!startResult.ok) throw new Error('startRun failed');

            const statusResult = await service.getRunStatus(createResult.value.preparationId);
            expect(statusResult.ok).toBe(true);
            if (!statusResult.ok) return;
            expect(statusResult.value.status).toBe('running');
        });
    });
});
