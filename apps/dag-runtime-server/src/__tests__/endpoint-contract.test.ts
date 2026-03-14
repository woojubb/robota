import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { PromptApiController } from '@robota-sdk/dag-api';
import type {
    IPromptBackendPort,
    IPromptRequest,
    IPromptResponse,
    IQueueStatus,
    IQueueAction,
    THistory,
    TObjectInfo,
    ISystemStats,
    TResult,
    IDagError,
} from '@robota-sdk/dag-core';
import { mountPromptRoutes } from '../routes/prompt-routes.js';
import { LocalFsAssetStore } from '../services/local-fs-asset-store.js';
import { mountAssetRoutes } from '../routes/asset-routes.js';

// ---------------------------------------------------------------------------
// Stub backend that returns known shapes without side-effects
// ---------------------------------------------------------------------------

class StubPromptBackend implements IPromptBackendPort {
    async submitPrompt(_request: IPromptRequest): Promise<TResult<IPromptResponse, IDagError>> {
        return {
            ok: true,
            value: {
                prompt_id: 'test-prompt-id',
                number: 1,
                node_errors: {},
            },
        };
    }

    async getQueue(): Promise<TResult<IQueueStatus, IDagError>> {
        return {
            ok: true,
            value: {
                queue_running: [],
                queue_pending: [],
            },
        };
    }

    async manageQueue(_action: IQueueAction): Promise<TResult<void, IDagError>> {
        return { ok: true, value: undefined };
    }

    async getHistory(promptId?: string): Promise<TResult<THistory, IDagError>> {
        if (typeof promptId === 'string') {
            return {
                ok: true,
                value: {
                    [promptId]: {
                        prompt: {},
                        outputs: {},
                        status: { status_str: 'success', completed: true, messages: [] },
                    },
                },
            };
        }
        return {
            ok: true,
            value: {
                'prompt-1': {
                    prompt: {},
                    outputs: {},
                    status: { status_str: 'success', completed: true, messages: [] },
                },
            },
        };
    }

    async getObjectInfo(nodeType?: string): Promise<TResult<TObjectInfo, IDagError>> {
        if (typeof nodeType === 'string') {
            if (nodeType === 'UnknownNode') {
                return {
                    ok: false,
                    error: {
                        code: 'NODE_TYPE_NOT_FOUND',
                        category: 'validation',
                        message: `Node type not found: ${nodeType}`,
                        retryable: false,
                    },
                };
            }
            return {
                ok: true,
                value: {
                    [nodeType]: {
                        display_name: nodeType,
                        category: 'test',
                        input: { required: {} },
                        output: ['STRING'],
                        output_is_list: [false],
                        output_name: ['output'],
                        output_node: false,
                        description: '',
                    },
                },
            };
        }
        return {
            ok: true,
            value: {
                TestNode: {
                    display_name: 'TestNode',
                    category: 'test',
                    input: { required: {} },
                    output: ['STRING'],
                    output_is_list: [false],
                    output_name: ['output'],
                    output_node: false,
                    description: '',
                },
            },
        };
    }

    async getSystemStats(): Promise<TResult<ISystemStats, IDagError>> {
        return {
            ok: true,
            value: {
                system: {
                    os: 'test-os',
                    runtime_version: 'v22.0.0',
                    embedded_python: false,
                },
                devices: [{
                    name: 'test-host',
                    type: 'cpu',
                    vram_total: 1024,
                    vram_free: 512,
                }],
            },
        };
    }
}

// ---------------------------------------------------------------------------
// Test server setup
// ---------------------------------------------------------------------------

let server: http.Server;
let baseUrl: string;
let assetStore: LocalFsAssetStore;
let tempAssetDir: string;

function createTestApp(): express.Express {
    const app = express();
    app.use(express.json());

    // Health endpoint (same as server.ts)
    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            service: 'dag-runtime-server',
            timestamp: new Date().toISOString(),
        });
    });

    const backend = new StubPromptBackend();
    const controller = new PromptApiController(backend);
    mountPromptRoutes(app, controller);
    mountAssetRoutes(app, assetStore);

    return app;
}

beforeAll(async () => {
    tempAssetDir = await mkdtemp(path.join(tmpdir(), 'dag-test-assets-'));
    assetStore = new LocalFsAssetStore(tempAssetDir);
    await assetStore.initialize();

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
    await rm(tempAssetDir, { recursive: true, force: true });
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

describe('dag-runtime-server endpoint contract tests', () => {
    // -----------------------------------------------------------------------
    // GET /health
    // -----------------------------------------------------------------------
    describe('GET /health', () => {
        it('returns 200 with { status, service, timestamp }', async () => {
            const { status, body } = await get('/health');

            expect(status).toBe(200);
            expect(body).toEqual(expect.objectContaining({
                status: 'ok',
                service: 'dag-runtime-server',
            }));
            expect(typeof (body as Record<string, unknown>).timestamp).toBe('string');
        });
    });

    // -----------------------------------------------------------------------
    // POST /prompt
    // -----------------------------------------------------------------------
    describe('POST /prompt', () => {
        it('returns 200 with { prompt_id (string), number (number), node_errors (object) }', async () => {
            const { status, body } = await post('/prompt', {
                prompt: {
                    '1': { class_type: 'TestNode', inputs: {} },
                },
            });

            expect(status).toBe(200);
            const response = body as Record<string, unknown>;
            expect(typeof response.prompt_id).toBe('string');
            expect(typeof response.number).toBe('number');
            expect(typeof response.node_errors).toBe('object');
            expect(response.node_errors).not.toBeNull();
        });

        it('returns 400 with ComfyUI error format when prompt is empty', async () => {
            const { status, body } = await post('/prompt', {
                prompt: {},
            });

            expect(status).toBe(400);
            const response = body as Record<string, unknown>;
            expect(response).toHaveProperty('error');
            expect(response).toHaveProperty('node_errors');

            const error = response.error as Record<string, unknown>;
            expect(typeof error.type).toBe('string');
            expect(typeof error.message).toBe('string');
            expect(error).toHaveProperty('details');
            expect(error).toHaveProperty('extra_info');
        });

        it('returns 400 with ComfyUI error format when node missing class_type', async () => {
            const { status, body } = await post('/prompt', {
                prompt: {
                    '1': { inputs: {} },
                },
            });

            expect(status).toBe(400);
            const response = body as Record<string, unknown>;
            expect(response).toHaveProperty('error');
            expect(response).toHaveProperty('node_errors');

            const error = response.error as Record<string, unknown>;
            expect(typeof error.type).toBe('string');
            expect(typeof error.message).toBe('string');
        });
    });

    // -----------------------------------------------------------------------
    // GET /prompt (queue info shorthand)
    // -----------------------------------------------------------------------
    describe('GET /prompt', () => {
        it('returns 200 with { exec_info: { queue_remaining: number } }', async () => {
            const { status, body } = await get('/prompt');

            expect(status).toBe(200);
            const response = body as Record<string, unknown>;
            expect(response).toHaveProperty('exec_info');
            const execInfo = response.exec_info as Record<string, unknown>;
            expect(typeof execInfo.queue_remaining).toBe('number');
        });
    });

    // -----------------------------------------------------------------------
    // GET /queue
    // -----------------------------------------------------------------------
    describe('GET /queue', () => {
        it('returns 200 with { queue_running (array), queue_pending (array) }', async () => {
            const { status, body } = await get('/queue');

            expect(status).toBe(200);
            const response = body as Record<string, unknown>;
            expect(Array.isArray(response.queue_running)).toBe(true);
            expect(Array.isArray(response.queue_pending)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // POST /queue
    // -----------------------------------------------------------------------
    describe('POST /queue', () => {
        it('returns 200 with empty object', async () => {
            const { status, body } = await post('/queue', { clear: true });

            expect(status).toBe(200);
            expect(body).toEqual({});
        });
    });

    // -----------------------------------------------------------------------
    // GET /history
    // -----------------------------------------------------------------------
    describe('GET /history', () => {
        it('returns 200 with Record<string, IHistoryEntry>', async () => {
            const { status, body } = await get('/history');

            expect(status).toBe(200);
            const response = body as Record<string, unknown>;
            expect(typeof response).toBe('object');
            expect(response).not.toBeNull();

            // Verify at least one entry has the correct shape
            const keys = Object.keys(response);
            expect(keys.length).toBeGreaterThan(0);

            const entry = response[keys[0]] as Record<string, unknown>;
            expect(entry).toHaveProperty('prompt');
            expect(entry).toHaveProperty('outputs');
            expect(entry).toHaveProperty('status');

            const entryStatus = entry.status as Record<string, unknown>;
            expect(typeof entryStatus.status_str).toBe('string');
            expect(typeof entryStatus.completed).toBe('boolean');
            expect(Array.isArray(entryStatus.messages)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // GET /history/:prompt_id
    // -----------------------------------------------------------------------
    describe('GET /history/:prompt_id', () => {
        it('returns 200 with single-entry Record<string, IHistoryEntry>', async () => {
            const promptId = 'test-prompt-123';
            const { status, body } = await get(`/history/${promptId}`);

            expect(status).toBe(200);
            const response = body as Record<string, unknown>;
            expect(typeof response).toBe('object');
            expect(response).not.toBeNull();

            // Should contain the requested prompt_id as key
            expect(response).toHaveProperty(promptId);
            const entry = response[promptId] as Record<string, unknown>;
            expect(entry).toHaveProperty('prompt');
            expect(entry).toHaveProperty('outputs');
            expect(entry).toHaveProperty('status');
        });
    });

    // -----------------------------------------------------------------------
    // GET /object_info
    // -----------------------------------------------------------------------
    describe('GET /object_info', () => {
        it('returns 200 with Record<string, INodeObjectInfo>', async () => {
            const { status, body } = await get('/object_info');

            expect(status).toBe(200);
            const response = body as Record<string, unknown>;
            expect(typeof response).toBe('object');
            expect(response).not.toBeNull();

            const keys = Object.keys(response);
            expect(keys.length).toBeGreaterThan(0);

            const info = response[keys[0]] as Record<string, unknown>;
            expect(typeof info.display_name).toBe('string');
            expect(typeof info.category).toBe('string');
            expect(info).toHaveProperty('input');
            expect(Array.isArray(info.output)).toBe(true);
            expect(Array.isArray(info.output_is_list)).toBe(true);
            expect(Array.isArray(info.output_name)).toBe(true);
            expect(typeof info.output_node).toBe('boolean');
            expect(typeof info.description).toBe('string');

            const input = info.input as Record<string, unknown>;
            expect(input).toHaveProperty('required');
        });
    });

    // -----------------------------------------------------------------------
    // GET /object_info/:node_type
    // -----------------------------------------------------------------------
    describe('GET /object_info/:node_type', () => {
        it('returns 200 with single-entry Record for known node type', async () => {
            const { status, body } = await get('/object_info/TestNode');

            expect(status).toBe(200);
            const response = body as Record<string, unknown>;
            expect(response).toHaveProperty('TestNode');

            const info = response.TestNode as Record<string, unknown>;
            expect(typeof info.display_name).toBe('string');
            expect(typeof info.category).toBe('string');
        });

        it('returns 400 with ComfyUI error format for unknown node type', async () => {
            const { status, body } = await get('/object_info/UnknownNode');

            expect(status).toBe(400);
            const response = body as Record<string, unknown>;
            expect(response).toHaveProperty('error');
            expect(response).toHaveProperty('node_errors');

            const error = response.error as Record<string, unknown>;
            expect(error.type).toBe('NODE_TYPE_NOT_FOUND');
            expect(typeof error.message).toBe('string');
            expect(error).toHaveProperty('details');
            expect(error).toHaveProperty('extra_info');
        });
    });

    // -----------------------------------------------------------------------
    // GET /system_stats
    // -----------------------------------------------------------------------
    describe('GET /system_stats', () => {
        it('returns 200 with { system (object), devices (array) }', async () => {
            const { status, body } = await get('/system_stats');

            expect(status).toBe(200);
            const response = body as Record<string, unknown>;
            expect(typeof response.system).toBe('object');
            expect(response.system).not.toBeNull();
            expect(Array.isArray(response.devices)).toBe(true);

            const system = response.system as Record<string, unknown>;
            expect(typeof system.os).toBe('string');
            expect(typeof system.runtime_version).toBe('string');
            expect(typeof system.embedded_python).toBe('boolean');

            const devices = response.devices as Record<string, unknown>[];
            expect(devices.length).toBeGreaterThan(0);
            expect(typeof devices[0].name).toBe('string');
            expect(typeof devices[0].type).toBe('string');
            expect(typeof devices[0].vram_total).toBe('number');
            expect(typeof devices[0].vram_free).toBe('number');
        });
    });

    // -----------------------------------------------------------------------
    // POST /interrupt (stub no-op)
    // -----------------------------------------------------------------------
    describe('POST /interrupt', () => {
        it('returns 200 with empty object', async () => {
            const { status, body } = await post('/interrupt');

            expect(status).toBe(200);
            expect(body).toEqual({});
        });
    });

    // -----------------------------------------------------------------------
    // POST /free (stub no-op)
    // -----------------------------------------------------------------------
    describe('POST /free', () => {
        it('returns 200 with empty object', async () => {
            const { status, body } = await post('/free');

            expect(status).toBe(200);
            expect(body).toEqual({});
        });
    });

    // -----------------------------------------------------------------------
    // GET /view
    // -----------------------------------------------------------------------
    describe('GET /view', () => {
        it('returns 200 with binary content for existing asset', async () => {
            const content = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
            const saved = await assetStore.save({
                fileName: 'test.png',
                mediaType: 'image/png',
                content,
            });
            const res = await fetch(`${baseUrl}/view?filename=${saved.assetId}`);
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toBe('image/png');
            const body = new Uint8Array(await res.arrayBuffer());
            expect(body).toEqual(content);
        });

        it('returns 404 when asset does not exist', async () => {
            const { status } = await get('/view?filename=nonexistent-id');
            expect(status).toBe(404);
        });

        it('returns 400 when filename query param is missing', async () => {
            const { status } = await get('/view');
            expect(status).toBe(400);
        });
    });

    // -----------------------------------------------------------------------
    // Error format contract: all errors use ComfyUI shape, NOT IProblemDetails
    // -----------------------------------------------------------------------
    describe('error response format', () => {
        it('does NOT use IProblemDetails shape (no "type" URL, no "title", no "status" field)', async () => {
            const { body } = await post('/prompt', { prompt: {} });
            const response = body as Record<string, unknown>;

            // ComfyUI shape: { error: { type, message, details, extra_info }, node_errors }
            expect(response).toHaveProperty('error');
            expect(response).toHaveProperty('node_errors');

            // IProblemDetails shape would have top-level "type" (URL), "title", "status"
            expect(response).not.toHaveProperty('title');
            expect(response).not.toHaveProperty('status');
            // top-level "type" should not exist (it is nested inside "error")
            expect(typeof response.type).toBe('undefined');

            const error = response.error as Record<string, unknown>;
            // ComfyUI error fields
            expect(typeof error.type).toBe('string');
            expect(typeof error.message).toBe('string');
            expect(error).toHaveProperty('details');
            expect(error).toHaveProperty('extra_info');
            expect(typeof error.extra_info).toBe('object');
        });
    });
});
