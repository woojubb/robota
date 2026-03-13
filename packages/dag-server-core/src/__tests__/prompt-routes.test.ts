import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import { mountPromptRoutes } from '../routes/prompt-routes.js';
import { PromptApiController } from '@robota-sdk/dag-api';
import { createStubPromptBackend } from '@robota-sdk/dag-core';

async function makeRequest(
    app: express.Express,
    method: string,
    path: string,
    body?: unknown,
): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(app);
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
                    ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr).toString() } : {}),
                },
            };
            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', (chunk: Buffer) => {
                    data += chunk.toString();
                });
                res.on('end', () => {
                    server.close();
                    let parsed: unknown;
                    try {
                        parsed = JSON.parse(data);
                    } catch {
                        parsed = data;
                    }
                    resolve({ status: res.statusCode ?? 0, body: parsed });
                });
            });
            req.on('error', (err) => {
                server.close();
                reject(err);
            });
            if (bodyStr) req.write(bodyStr);
            req.end();
        });
    });
}

describe('Prompt API routes (matches OpenAPI spec paths)', () => {
    let app: express.Express;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        mountPromptRoutes(app, new PromptApiController(createStubPromptBackend()));
    });

    it('POST /prompt → 200 with prompt_id', async () => {
        const res = await makeRequest(app, 'POST', '/prompt', {
            prompt: { '1': { class_type: 'TestNode', inputs: {} } },
        });
        expect(res.status).toBe(200);
        expect((res.body as Record<string, unknown>).prompt_id).toBe('stub-prompt-id');
    });

    it('POST /prompt → 400 on empty prompt', async () => {
        const res = await makeRequest(app, 'POST', '/prompt', { prompt: {} });
        expect(res.status).toBe(400);
    });

    it('GET /queue → 200', async () => {
        const res = await makeRequest(app, 'GET', '/queue');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('queue_running');
    });

    it('POST /queue → 200', async () => {
        const res = await makeRequest(app, 'POST', '/queue', { clear: true });
        expect(res.status).toBe(200);
    });

    it('GET /history → 200', async () => {
        const res = await makeRequest(app, 'GET', '/history');
        expect(res.status).toBe(200);
    });

    it('GET /history/:prompt_id → 200', async () => {
        const res = await makeRequest(app, 'GET', '/history/some-id');
        expect(res.status).toBe(200);
    });

    it('GET /object_info → 200', async () => {
        const res = await makeRequest(app, 'GET', '/object_info');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('TestNode');
    });

    it('GET /object_info/:node_type → 200', async () => {
        const res = await makeRequest(app, 'GET', '/object_info/TestNode');
        expect(res.status).toBe(200);
    });

    it('GET /system_stats → 200', async () => {
        const res = await makeRequest(app, 'GET', '/system_stats');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('system');
    });
});
