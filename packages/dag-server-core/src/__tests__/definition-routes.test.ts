import { describe, expect, it, vi, beforeEach } from 'vitest';
import express, { type Router } from 'express';
import http from 'node:http';
import { registerDefinitionRoutes } from '../routes/definition-routes.js';
import type { IAssetStore } from '../asset-store-contract.js';

function createMockDesignController(): any {
    return {
        createDefinition: vi.fn().mockResolvedValue({ status: 201, ok: true, data: {} }),
        updateDraft: vi.fn().mockResolvedValue({ status: 200, ok: true, data: {} }),
        validateDefinition: vi.fn().mockResolvedValue({ status: 200, ok: true, data: {} }),
        publishDefinition: vi.fn().mockResolvedValue({ status: 200, ok: true, data: {} }),
        getDefinition: vi.fn().mockResolvedValue({ status: 200, ok: true, data: { definition: { dagId: 'dag-1', version: 1, status: 'draft', nodes: [], edges: [] } } }),
        listDefinitions: vi.fn().mockResolvedValue({ status: 200, ok: true, data: [] }),
        listNodeCatalog: vi.fn().mockResolvedValue({ status: 200, ok: true, data: [] })
    };
}

function createMockAssetStore(): IAssetStore {
    return {
        save: vi.fn(),
        saveReference: vi.fn(),
        getMetadata: vi.fn().mockResolvedValue(undefined),
        getContent: vi.fn()
    };
}

function createTestApp(designController: any, assetStore: IAssetStore): Router {
    const app = express();
    app.use(express.json());
    registerDefinitionRoutes(app as unknown as Router, designController, assetStore);
    return app as unknown as Router;
}

async function makeRequest(
    app: Router,
    method: string,
    path: string,
    body?: unknown
): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(app as any);
        server.listen(0, () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close();
                reject(new Error('Failed to get server address'));
                return;
            }
            const port = address.port;
            const bodyStr = body ? JSON.stringify(body) : undefined;
            const options: http.RequestOptions = {
                method,
                hostname: 'localhost',
                port,
                path,
                headers: {
                    'Content-Type': 'application/json',
                    ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr).toString() } : {})
                }
            };
            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                res.on('end', () => {
                    server.close();
                    let parsed: any;
                    try { parsed = JSON.parse(data); } catch { parsed = data; }
                    resolve({ status: res.statusCode ?? 0, body: parsed });
                });
            });
            req.on('error', (err) => { server.close(); reject(err); });
            if (bodyStr) { req.write(bodyStr); }
            req.end();
        });
    });
}

describe('definition-routes', () => {
    let designController: any;
    let assetStore: IAssetStore;
    let app: Router;

    beforeEach(() => {
        designController = createMockDesignController();
        assetStore = createMockAssetStore();
        app = createTestApp(designController, assetStore);
    });

    describe('POST /v1/dag/definitions', () => {
        it('returns 400 when definition is missing', async () => {
            const res = await makeRequest(app, 'POST', '/v1/dag/definitions', {});
            expect(res.status).toBe(400);
            expect(res.body.errors[0].code).toBe('DAG_VALIDATION_DEFINITION_REQUIRED');
        });

        it('returns 201 on successful creation', async () => {
            const res = await makeRequest(app, 'POST', '/v1/dag/definitions', {
                definition: { dagId: 'dag-1', version: 1, status: 'draft', nodes: [], edges: [] }
            });
            expect(res.status).toBe(201);
        });
    });

    describe('PUT /v1/dag/definitions/:dagId/draft', () => {
        it('returns 400 when definition is missing', async () => {
            const res = await makeRequest(app, 'PUT', '/v1/dag/definitions/dag-1/draft', {
                version: 1
            });
            expect(res.status).toBe(400);
            expect(res.body.errors[0].code).toBe('DAG_VALIDATION_DEFINITION_REQUIRED');
        });

        it('returns 200 on successful update', async () => {
            const res = await makeRequest(app, 'PUT', '/v1/dag/definitions/dag-1/draft', {
                version: 1,
                definition: { dagId: 'dag-1', version: 1, status: 'draft', nodes: [], edges: [] }
            });
            expect(res.status).toBe(200);
        });
    });

    describe('POST /v1/dag/definitions/:dagId/validate', () => {
        it('returns validation result', async () => {
            const res = await makeRequest(app, 'POST', '/v1/dag/definitions/dag-1/validate', {
                version: 1
            });
            expect(res.status).toBe(200);
        });

        it('returns error when definition not found', async () => {
            designController.getDefinition.mockResolvedValue({
                status: 404, ok: false, errors: [{ code: 'NOT_FOUND' }]
            });
            const res = await makeRequest(app, 'POST', '/v1/dag/definitions/dag-1/validate', {
                version: 1
            });
            expect(res.status).toBe(404);
        });
    });

    describe('POST /v1/dag/definitions/:dagId/publish', () => {
        it('returns publish result', async () => {
            const res = await makeRequest(app, 'POST', '/v1/dag/definitions/dag-1/publish', {
                version: 1
            });
            expect(res.status).toBe(200);
        });
    });

    describe('GET /v1/dag/definitions/:dagId', () => {
        it('returns definition', async () => {
            const res = await makeRequest(app, 'GET', '/v1/dag/definitions/dag-1');
            expect(res.status).toBe(200);
        });

        it('returns 400 for invalid version query', async () => {
            const res = await makeRequest(app, 'GET', '/v1/dag/definitions/dag-1?version=abc');
            expect(res.status).toBe(400);
        });
    });

    describe('GET /v1/dag/definitions', () => {
        it('returns definition list', async () => {
            const res = await makeRequest(app, 'GET', '/v1/dag/definitions');
            expect(res.status).toBe(200);
        });
    });

    describe('GET /v1/dag/nodes', () => {
        it('returns node catalog', async () => {
            const res = await makeRequest(app, 'GET', '/v1/dag/nodes');
            expect(res.status).toBe(200);
        });
    });
});
