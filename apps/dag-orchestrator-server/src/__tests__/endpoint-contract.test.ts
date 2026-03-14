import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import type {
    IDagDefinition,
    IAssetStore,
    ICreateAssetInput,
    ICreateAssetReferenceInput,
    IStoredAssetMetadata,
    IAssetContentResult,
    TResult,
    IDagError,
    IPromptRequest,
    IPromptResponse,
    THistory,
} from '@robota-sdk/dag-core';
import { OrchestratorRunService } from '@robota-sdk/dag-orchestrator';
import type { IPromptApiClientPort } from '@robota-sdk/dag-orchestrator';
import { registerRunRoutes } from '../routes/run-routes.js';

// ---------------------------------------------------------------------------
// Stub IPromptApiClientPort
// ---------------------------------------------------------------------------

class StubPromptApiClient implements IPromptApiClientPort {
    private nextPromptId = 'prompt-abc-123';

    async submitPrompt(_request: IPromptRequest): Promise<TResult<IPromptResponse, IDagError>> {
        return {
            ok: true,
            value: {
                prompt_id: this.nextPromptId,
                number: 1,
                node_errors: {},
            },
        };
    }

    async getQueue(): Promise<TResult<{ queue_running: unknown[]; queue_pending: unknown[] }, IDagError>> {
        return { ok: true, value: { queue_running: [], queue_pending: [] } };
    }

    async manageQueue(): Promise<TResult<void, IDagError>> {
        return { ok: true, value: undefined };
    }

    async getHistory(promptId?: string): Promise<TResult<THistory, IDagError>> {
        if (typeof promptId === 'string') {
            return {
                ok: true,
                value: {
                    [promptId]: {
                        prompt: {},
                        outputs: { '1': { images: [{ filename: 'out.png' }] } },
                        status: { status_str: 'success', completed: true, messages: [] },
                    },
                },
            };
        }
        return { ok: true, value: {} };
    }

    async getObjectInfo(): Promise<TResult<Record<string, unknown>, IDagError>> {
        return { ok: true, value: {} };
    }

    async getSystemStats(): Promise<TResult<{ system: Record<string, unknown>; devices: unknown[] }, IDagError>> {
        return { ok: true, value: { system: {}, devices: [] } };
    }
}

// ---------------------------------------------------------------------------
// Stub IAssetStore (no-op, all assets "exist")
// ---------------------------------------------------------------------------

class StubAssetStore implements IAssetStore {
    async save(_input: ICreateAssetInput): Promise<IStoredAssetMetadata> {
        return { assetId: 'asset-1', fileName: 'test.png', mediaType: 'image/png', sizeBytes: 100, createdAt: new Date().toISOString() };
    }

    async saveReference(_input: ICreateAssetReferenceInput): Promise<IStoredAssetMetadata> {
        return { assetId: 'asset-1', fileName: 'test.png', mediaType: 'image/png', sizeBytes: 100, createdAt: new Date().toISOString() };
    }

    async getMetadata(assetId: string): Promise<IStoredAssetMetadata | undefined> {
        return { assetId, fileName: 'test.png', mediaType: 'image/png', sizeBytes: 100, createdAt: new Date().toISOString() };
    }

    async getContent(_assetId: string): Promise<IAssetContentResult | undefined> {
        return { data: Buffer.from('test'), mediaType: 'image/png' };
    }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createMinimalDefinition(): IDagDefinition {
    return {
        dagId: 'test-dag',
        version: 1,
        status: 'draft',
        nodes: [
            {
                nodeId: '1',
                nodeType: 'text-template',
                config: { template: 'hello' },
            },
        ],
        edges: [],
    };
}

// ---------------------------------------------------------------------------
// Test server setup
// ---------------------------------------------------------------------------

let server: http.Server;
let baseUrl: string;
let runService: OrchestratorRunService;

function createTestApp(): express.Express {
    const app = express();
    app.use(express.json());

    const promptClient = new StubPromptApiClient();
    runService = new OrchestratorRunService(promptClient);
    const assetStore = new StubAssetStore();

    const router = express.Router();
    registerRunRoutes(router, runService, assetStore);
    app.use(router);

    return app;
}

beforeAll(async () => {
    const app = createTestApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
        server.listen(0, () => resolve());
    });
    const address = server.address();
    if (typeof address !== 'object' || address === null) {
        throw new Error('Server did not bind to a port');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
    });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function get(path: string): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${baseUrl}${path}`);
    const body: unknown = await res.json();
    return { status: res.status, body };
}

async function post(path: string, payload?: unknown): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof payload !== 'undefined' ? JSON.stringify(payload) : undefined,
    });
    const body: unknown = await res.json();
    return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

describe('dag-orchestrator-server endpoint contract tests', () => {
    // -----------------------------------------------------------------------
    // Response envelope shape
    // -----------------------------------------------------------------------
    describe('success response envelope', () => {
        it('has { ok: true, status: number, data: object } shape', async () => {
            const { status, body } = await post('/v1/dag/runs', {
                definition: createMinimalDefinition(),
            });

            expect(status).toBe(201);
            const envelope = body as Record<string, unknown>;
            expect(envelope.ok).toBe(true);
            expect(envelope.status).toBe(201);
            expect(typeof envelope.data).toBe('object');
            expect(envelope.data).not.toBeNull();
        });
    });

    describe('error response envelope', () => {
        it('has { ok: false, status: number, errors: IProblemDetails[] } shape', async () => {
            const { status, body } = await post('/v1/dag/runs', {});

            expect(status).toBe(400);
            const envelope = body as Record<string, unknown>;
            expect(envelope.ok).toBe(false);
            expect(envelope.status).toBe(400);
            expect(Array.isArray(envelope.errors)).toBe(true);

            const errors = envelope.errors as Record<string, unknown>[];
            expect(errors.length).toBeGreaterThan(0);

            const error = errors[0];
            expect(typeof error.type).toBe('string');
            expect(typeof error.title).toBe('string');
            expect(typeof error.status).toBe('number');
            expect(typeof error.detail).toBe('string');
            expect(typeof error.instance).toBe('string');
            expect(typeof error.code).toBe('string');
            expect(typeof error.retryable).toBe('boolean');
        });
    });

    // -----------------------------------------------------------------------
    // POST /v1/dag/runs
    // -----------------------------------------------------------------------
    describe('POST /v1/dag/runs', () => {
        it('returns 201 with { ok: true, data: { preparationId } }', async () => {
            const { status, body } = await post('/v1/dag/runs', {
                definition: createMinimalDefinition(),
            });

            expect(status).toBe(201);
            const envelope = body as { ok: boolean; status: number; data: { preparationId: string } };
            expect(envelope.ok).toBe(true);
            expect(envelope.status).toBe(201);
            expect(typeof envelope.data.preparationId).toBe('string');
            expect(envelope.data.preparationId.length).toBeGreaterThan(0);
        });

        it('returns 400 with IProblemDetails when definition is missing', async () => {
            const { status, body } = await post('/v1/dag/runs', {});

            expect(status).toBe(400);
            const envelope = body as { ok: boolean; errors: Array<{ code: string }> };
            expect(envelope.ok).toBe(false);
            expect(envelope.errors[0].code).toBe('DAG_VALIDATION_RUN_DEFINITION_REQUIRED');
        });

        it('returns 400 with IProblemDetails when input is not an object', async () => {
            const { status, body } = await post('/v1/dag/runs', {
                definition: createMinimalDefinition(),
                input: 'invalid',
            });

            expect(status).toBe(400);
            const envelope = body as { ok: boolean; errors: Array<{ code: string }> };
            expect(envelope.ok).toBe(false);
            expect(envelope.errors[0].code).toBe('DAG_VALIDATION_RUN_INPUT_INVALID');
        });
    });

    // -----------------------------------------------------------------------
    // POST /v1/dag/runs/:id/start
    // -----------------------------------------------------------------------
    describe('POST /v1/dag/runs/:id/start', () => {
        it('returns 202 with { ok: true, data: { dagRunId, preparationId } }', async () => {
            // First create a run
            const createResult = await post('/v1/dag/runs', {
                definition: createMinimalDefinition(),
            });
            const { preparationId } = (createResult.body as { data: { preparationId: string } }).data;

            // Then start it
            const { status, body } = await post(`/v1/dag/runs/${preparationId}/start`);

            expect(status).toBe(202);
            const envelope = body as { ok: boolean; status: number; data: { dagRunId: string; preparationId: string } };
            expect(envelope.ok).toBe(true);
            expect(envelope.status).toBe(202);
            expect(typeof envelope.data.dagRunId).toBe('string');
            expect(typeof envelope.data.preparationId).toBe('string');
            expect(envelope.data.preparationId).toBe(preparationId);
            expect(envelope.data.dagRunId.length).toBeGreaterThan(0);
        });

        it('returns 404 when preparationId does not exist', async () => {
            const { status, body } = await post('/v1/dag/runs/nonexistent-id/start');

            expect(status).toBe(404);
            const envelope = body as { ok: boolean; errors: Array<{ code: string }> };
            expect(envelope.ok).toBe(false);
            expect(envelope.errors[0].code).toBe('ORCHESTRATOR_RUN_NOT_FOUND');
        });
    });

    // -----------------------------------------------------------------------
    // GET /v1/dag/runs/:id/result — success
    // -----------------------------------------------------------------------
    describe('GET /v1/dag/runs/:id/result', () => {
        it('returns run result with { dagRunId, status, traces, nodeErrors, totalCostUsd } on success', async () => {
            // Create and start a run
            const createResult = await post('/v1/dag/runs', {
                definition: createMinimalDefinition(),
            });
            const { preparationId } = (createResult.body as { data: { preparationId: string } }).data;

            const startResult = await post(`/v1/dag/runs/${preparationId}/start`);
            const { dagRunId } = (startResult.body as { data: { dagRunId: string } }).data;

            // Get result (stub returns success history)
            const { status, body } = await get(`/v1/dag/runs/${dagRunId}/result`);

            expect(status).toBe(200);
            const envelope = body as {
                ok: boolean;
                status: number;
                data: {
                    run: {
                        dagRunId: string;
                        status: string;
                        traces: unknown[];
                        nodeErrors: unknown[];
                        totalCostUsd: number;
                    };
                };
            };
            expect(envelope.ok).toBe(true);
            expect(envelope.status).toBe(200);

            const run = envelope.data.run;
            expect(typeof run.dagRunId).toBe('string');
            expect(run.status).toBe('success');
            expect(Array.isArray(run.traces)).toBe(true);
            expect(Array.isArray(run.nodeErrors)).toBe(true);
            expect(run.nodeErrors).toHaveLength(0);
            expect(typeof run.totalCostUsd).toBe('number');
        });

        it('returns 409 when run has not been started yet', async () => {
            // Create a run but do NOT start it
            const createResult = await post('/v1/dag/runs', {
                definition: createMinimalDefinition(),
            });
            const { preparationId } = (createResult.body as { data: { preparationId: string } }).data;

            const { status, body } = await get(`/v1/dag/runs/${preparationId}/result`);

            expect(status).toBe(409);
            const envelope = body as { ok: boolean; errors: Array<{ code: string }> };
            expect(envelope.ok).toBe(false);
            expect(envelope.errors[0].code).toBe('ORCHESTRATOR_RUN_NOT_COMPLETED');
        });

        it('returns 404 when run does not exist', async () => {
            const { status, body } = await get('/v1/dag/runs/nonexistent-id/result');

            expect(status).toBe(404);
            const envelope = body as { ok: boolean; errors: Array<{ code: string }> };
            expect(envelope.ok).toBe(false);
            expect(envelope.errors[0].code).toBe('ORCHESTRATOR_RUN_NOT_FOUND');
        });
    });

    // -----------------------------------------------------------------------
    // GET /v1/dag/runs/:id
    // -----------------------------------------------------------------------
    describe('GET /v1/dag/runs/:id', () => {
        it('returns run status with { dagRunId, status }', async () => {
            const createResult = await post('/v1/dag/runs', {
                definition: createMinimalDefinition(),
            });
            const { preparationId } = (createResult.body as { data: { preparationId: string } }).data;

            const { status, body } = await get(`/v1/dag/runs/${preparationId}`);

            expect(status).toBe(200);
            const envelope = body as {
                ok: boolean;
                data: { dagRunId: string; status: string };
            };
            expect(envelope.ok).toBe(true);
            expect(typeof envelope.data.dagRunId).toBe('string');
            expect(envelope.data.status).toBe('pending');
        });

        it('returns 404 with IProblemDetails for unknown run id', async () => {
            const { status, body } = await get('/v1/dag/runs/nonexistent-id');

            expect(status).toBe(404);
            const envelope = body as { ok: boolean; errors: Array<Record<string, unknown>> };
            expect(envelope.ok).toBe(false);
            expect(Array.isArray(envelope.errors)).toBe(true);

            const error = envelope.errors[0];
            expect(typeof error.type).toBe('string');
            expect(typeof error.title).toBe('string');
            expect(typeof error.status).toBe('number');
            expect(typeof error.detail).toBe('string');
            expect(typeof error.instance).toBe('string');
            expect(typeof error.code).toBe('string');
            expect(typeof error.retryable).toBe('boolean');
        });
    });

    // -----------------------------------------------------------------------
    // Error format uses IProblemDetails shape
    // -----------------------------------------------------------------------
    describe('error response format', () => {
        it('uses IProblemDetails shape with type, title, status, detail, instance, code, retryable', async () => {
            const { body } = await post('/v1/dag/runs', {});
            const envelope = body as { errors: Array<Record<string, unknown>> };

            const error = envelope.errors[0];
            expect(error.type).toMatch(/^urn:robota:problems:/);
            expect(typeof error.title).toBe('string');
            expect(typeof error.status).toBe('number');
            expect(typeof error.detail).toBe('string');
            expect(typeof error.instance).toBe('string');
            expect(typeof error.code).toBe('string');
            expect(typeof error.retryable).toBe('boolean');
        });
    });
});
