import { describe, expect, it, vi, beforeEach } from 'vitest';
import express, { type Router } from 'express';
import http from 'node:http';
import { registerAssetRoutes } from '../routes/asset-routes.js';
import type { IAssetStore, IStoredAssetMetadata } from '../asset-store-contract.js';
import { Readable } from 'node:stream';

function createMockAssetStore(): IAssetStore {
    return {
        save: vi.fn(),
        saveReference: vi.fn(),
        getMetadata: vi.fn(),
        getContent: vi.fn()
    };
}

function createSampleMetadata(assetId: string = 'asset-1'): IStoredAssetMetadata {
    return {
        assetId,
        fileName: 'test.png',
        mediaType: 'image/png',
        sizeBytes: 1024,
        createdAt: '2026-01-01T00:00:00.000Z'
    };
}

/**
 * Creates a minimal Express app with the asset routes registered and JSON parsing enabled.
 */
function createTestApp(assetStore: IAssetStore): Router {
    const app = express();
    app.use(express.json());
    registerAssetRoutes(app as unknown as Router, assetStore);
    return app as unknown as Router;
}

/**
 * Performs a supertest-like request on the Express app using node http.
 * We use a lightweight approach: create a test server, make a request, close.
 */
async function makeRequest(
    app: Router,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
): Promise<{ status: number; body: any; headers: Record<string, string> }> {
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
            const url = `http://localhost:${port}${path}`;
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
                    try {
                        parsed = JSON.parse(data);
                    } catch {
                        parsed = data;
                    }
                    const headers: Record<string, string> = {};
                    for (const [key, value] of Object.entries(res.headers)) {
                        if (typeof value === 'string') {
                            headers[key] = value;
                        }
                    }
                    resolve({ status: res.statusCode ?? 0, body: parsed, headers });
                });
            });
            req.on('error', (err) => {
                server.close();
                reject(err);
            });
            if (bodyStr) {
                req.write(bodyStr);
            }
            req.end();
        });
    });
}

describe('asset-routes', () => {
    let assetStore: IAssetStore;
    let app: Router;

    beforeEach(() => {
        assetStore = createMockAssetStore();
        app = createTestApp(assetStore);
    });

    describe('POST /v1/dag/assets', () => {
        it('returns 400 when fileName is missing', async () => {
            const res = await makeRequest(app, 'POST', '/v1/dag/assets', {
                mediaType: 'image/png',
                base64Data: Buffer.from('test').toString('base64')
            });
            expect(res.status).toBe(400);
            expect(res.body.errors[0].code).toBe('DAG_VALIDATION_ASSET_FILENAME_REQUIRED');
        });

        it('returns 400 when mediaType is missing', async () => {
            const res = await makeRequest(app, 'POST', '/v1/dag/assets', {
                fileName: 'test.png',
                base64Data: Buffer.from('test').toString('base64')
            });
            expect(res.status).toBe(400);
            expect(res.body.errors[0].code).toBe('DAG_VALIDATION_ASSET_MEDIATYPE_REQUIRED');
        });

        it('returns 400 when base64Data is missing', async () => {
            const res = await makeRequest(app, 'POST', '/v1/dag/assets', {
                fileName: 'test.png',
                mediaType: 'image/png'
            });
            expect(res.status).toBe(400);
            expect(res.body.errors[0].code).toBe('DAG_VALIDATION_ASSET_BASE64_REQUIRED');
        });

        it('returns 201 with asset reference on success', async () => {
            (assetStore.save as any).mockResolvedValue(createSampleMetadata());
            const res = await makeRequest(app, 'POST', '/v1/dag/assets', {
                fileName: 'test.png',
                mediaType: 'image/png',
                base64Data: Buffer.from('png-data').toString('base64')
            });
            expect(res.status).toBe(201);
            expect(res.body.ok).toBe(true);
            expect(res.body.data.asset.assetId).toBe('asset-1');
        });

        it('returns 400 when decoded base64 content is empty', async () => {
            const res = await makeRequest(app, 'POST', '/v1/dag/assets', {
                fileName: 'test.png',
                mediaType: 'image/png',
                base64Data: ''
            });
            // Empty string fails the base64Data check before decoding
            expect(res.status).toBe(400);
        });
    });

    describe('GET /v1/dag/assets/:assetId', () => {
        it('returns 404 when asset not found', async () => {
            (assetStore.getMetadata as any).mockResolvedValue(undefined);
            const res = await makeRequest(app, 'GET', '/v1/dag/assets/unknown');
            expect(res.status).toBe(404);
            expect(res.body.errors[0].code).toBe('DAG_ASSET_NOT_FOUND');
        });

        it('returns 200 with asset metadata', async () => {
            (assetStore.getMetadata as any).mockResolvedValue(createSampleMetadata());
            const res = await makeRequest(app, 'GET', '/v1/dag/assets/asset-1');
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.data.asset.assetId).toBe('asset-1');
        });
    });

    describe('GET /v1/dag/assets/:assetId/content', () => {
        it('returns 404 when asset content not found', async () => {
            (assetStore.getContent as any).mockResolvedValue(undefined);
            const res = await makeRequest(app, 'GET', '/v1/dag/assets/unknown/content');
            expect(res.status).toBe(404);
        });

        it('returns content stream with proper headers', async () => {
            const stream = new Readable();
            stream.push('binary-data');
            stream.push(null);
            (assetStore.getContent as any).mockResolvedValue({
                stream,
                metadata: createSampleMetadata()
            });
            const res = await makeRequest(app, 'GET', '/v1/dag/assets/asset-1/content');
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toBe('image/png');
        });
    });
});
