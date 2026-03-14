import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import multer from 'multer';
import { registerRuntimeAssetRoutes } from '../routes/runtime-asset-routes.js';

// ---------------------------------------------------------------------------
// Fake runtime backend (simulates dag-runtime-server)
// ---------------------------------------------------------------------------

let fakeRuntimeServer: http.Server;
let fakeRuntimeUrl: string;

function createFakeRuntimeApp(): express.Express {
    const app = express();

    // GET /view — serve a fake binary asset
    app.get('/view', (req, res) => {
        const filename = req.query.filename;
        if (typeof filename !== 'string' || filename.trim().length === 0) {
            res.status(400).json({
                error: { type: 'invalid_request', message: 'filename query parameter is required', details: '', extra_info: {} },
                node_errors: {},
            });
            return;
        }
        if (filename === 'missing.png') {
            res.status(404).json({
                error: { type: 'not_found', message: 'Asset not found', details: '', extra_info: {} },
                node_errors: {},
            });
            return;
        }
        const content = Buffer.from('FAKE_IMAGE_BINARY_DATA');
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Length', String(content.length));
        res.end(content);
    });

    // POST /upload/image — accept multipart and return ComfyUI-shaped response
    const upload = multer({ storage: multer.memoryStorage() });
    app.post('/upload/image', upload.single('image'), (req, res) => {
        const file = (req as express.Request & { file?: Express.Multer.File }).file;
        if (!file) {
            res.status(400).json({
                error: { type: 'invalid_request', message: 'No image file provided', details: '', extra_info: {} },
                node_errors: {},
            });
            return;
        }
        res.status(200).json({
            name: `asset-${file.originalname}`,
            subfolder: '',
            type: 'input',
        });
    });

    return app;
}

// ---------------------------------------------------------------------------
// Orchestrator test server (routes under test)
// ---------------------------------------------------------------------------

let orchestratorServer: http.Server;
let orchestratorUrl: string;

beforeAll(async () => {
    // 1. Start fake runtime backend
    const fakeApp = createFakeRuntimeApp();
    fakeRuntimeServer = http.createServer(fakeApp);
    await new Promise<void>((resolve) => {
        fakeRuntimeServer.listen(0, () => resolve());
    });
    const fakeAddr = fakeRuntimeServer.address();
    if (typeof fakeAddr !== 'object' || fakeAddr === null) {
        throw new Error('Fake runtime did not bind');
    }
    fakeRuntimeUrl = `http://127.0.0.1:${fakeAddr.port}`;

    // 2. Start orchestrator with runtime asset routes pointing to fake backend
    const orchApp = express();
    orchApp.use(express.json());
    registerRuntimeAssetRoutes(orchApp, fakeRuntimeUrl);
    orchestratorServer = http.createServer(orchApp);
    await new Promise<void>((resolve) => {
        orchestratorServer.listen(0, () => resolve());
    });
    const orchAddr = orchestratorServer.address();
    if (typeof orchAddr !== 'object' || orchAddr === null) {
        throw new Error('Orchestrator did not bind');
    }
    orchestratorUrl = `http://127.0.0.1:${orchAddr.port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
        orchestratorServer.close((err) => (err ? reject(err) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
        fakeRuntimeServer.close((err) => (err ? reject(err) : resolve()));
    });
});

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

describe('runtime asset mapped routes (orchestrator → runtime)', () => {
    // -----------------------------------------------------------------------
    // GET /view
    // -----------------------------------------------------------------------
    describe('GET /view', () => {
        it('returns 400 when filename is missing', async () => {
            const res = await fetch(`${orchestratorUrl}/view`);
            expect(res.status).toBe(400);

            const body = await res.json() as { ok: boolean; errors: Array<{ code: string }> };
            expect(body.ok).toBe(false);
            expect(body.errors[0].code).toBe('DAG_VALIDATION_FILENAME_REQUIRED');
        });

        it('forwards to runtime and streams binary content back', async () => {
            const res = await fetch(`${orchestratorUrl}/view?filename=test.png`);
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toBe('image/png');

            const buf = await res.arrayBuffer();
            const text = new TextDecoder().decode(buf);
            expect(text).toBe('FAKE_IMAGE_BINARY_DATA');
        });

        it('forwards runtime 404 when asset is not found', async () => {
            const res = await fetch(`${orchestratorUrl}/view?filename=missing.png`);
            expect(res.status).toBe(404);

            const body = await res.json() as { error: { type: string } };
            expect(body.error.type).toBe('not_found');
        });
    });

    // -----------------------------------------------------------------------
    // POST /upload/image
    // -----------------------------------------------------------------------
    describe('POST /upload/image', () => {
        it('returns 400 when Content-Type is not multipart', async () => {
            const res = await fetch(`${orchestratorUrl}/upload/image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);

            const body = await res.json() as { ok: boolean; errors: Array<{ code: string }> };
            expect(body.ok).toBe(false);
            expect(body.errors[0].code).toBe('DAG_VALIDATION_MULTIPART_REQUIRED');
        });

        it('forwards multipart upload to runtime and returns ComfyUI response', async () => {
            const boundary = '----TestBoundary' + Date.now();
            const fileContent = Buffer.from('PNG_FILE_CONTENT');
            const bodyParts = [
                `--${boundary}\r\n`,
                'Content-Disposition: form-data; name="image"; filename="photo.png"\r\n',
                'Content-Type: image/png\r\n',
                '\r\n',
                fileContent.toString(),
                `\r\n--${boundary}--\r\n`,
            ];
            const body = bodyParts.join('');

            const res = await fetch(`${orchestratorUrl}/upload/image`, {
                method: 'POST',
                headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
                body,
            });
            expect(res.status).toBe(200);

            const json = await res.json() as { name: string; subfolder: string; type: string };
            expect(json.name).toBe('asset-photo.png');
            expect(json.subfolder).toBe('');
            expect(json.type).toBe('input');
        });
    });

    // -----------------------------------------------------------------------
    // Backend unreachable
    // -----------------------------------------------------------------------
    describe('runtime backend unreachable', () => {
        it('returns 502 for GET /view when backend is unreachable', async () => {
            // Create a separate orchestrator pointing to a dead backend
            const deadApp = express();
            registerRuntimeAssetRoutes(deadApp, 'http://127.0.0.1:1');
            const deadServer = http.createServer(deadApp);
            await new Promise<void>((resolve) => {
                deadServer.listen(0, () => resolve());
            });
            const addr = deadServer.address();
            if (typeof addr !== 'object' || addr === null) {
                throw new Error('Dead backend orchestrator did not bind');
            }
            const deadUrl = `http://127.0.0.1:${addr.port}`;

            try {
                const res = await fetch(`${deadUrl}/view?filename=test.png`);
                expect(res.status).toBe(502);

                const body = await res.json() as { ok: boolean; errors: Array<{ code: string }> };
                expect(body.ok).toBe(false);
                expect(body.errors[0].code).toBe('DAG_RUNTIME_UNREACHABLE');
            } finally {
                await new Promise<void>((resolve) => {
                    deadServer.close(() => resolve());
                });
            }
        });
    });
});
