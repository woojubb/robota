import { describe, expect, it, vi, beforeEach } from 'vitest';
import express, { type Router } from 'express';
import http from 'node:http';
import { registerDevRoutes } from '../routes/dev-routes.js';
import type { ILlmRuntimeClient } from '../routes/route-types.js';

function createMockDesignController(): any {
    return {
        createDefinition: vi.fn().mockResolvedValue({ status: 201, ok: true, data: {} }),
        publishDefinition: vi.fn().mockResolvedValue({ status: 200, ok: true, data: {} })
    };
}

function createMockWorkerLoop(): any {
    return {
        processOnce: vi.fn().mockResolvedValue({ ok: true, value: { processed: true } })
    };
}

function createMockLlmClient(): ILlmRuntimeClient {
    return {
        resolveModelSelection: vi.fn().mockReturnValue({
            ok: true,
            value: { provider: 'openai', model: 'gpt-4' }
        }),
        generateCompletion: vi.fn().mockResolvedValue({
            ok: true,
            value: 'Generated text'
        })
    };
}

function createTestApp(
    designController: any,
    workerLoop: any,
    llmClient?: ILlmRuntimeClient
): Router {
    const app = express();
    app.use(express.json());
    registerDevRoutes(app as unknown as Router, designController, workerLoop, llmClient);
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

describe('dev-routes', () => {
    let designController: any;
    let workerLoop: any;

    beforeEach(() => {
        designController = createMockDesignController();
        workerLoop = createMockWorkerLoop();
    });

    describe('POST /v1/dag/dev/bootstrap', () => {
        it('returns 201 on successful bootstrap', async () => {
            const app = createTestApp(designController, workerLoop);
            const res = await makeRequest(app, 'POST', '/v1/dag/dev/bootstrap', {});
            expect(res.status).toBe(201);
            expect(res.body.ok).toBe(true);
            expect(res.body.data.dagId).toBe('dag-dev-sample');
        });

        it('returns error when create fails', async () => {
            designController.createDefinition.mockResolvedValue({
                status: 400, ok: false, errors: [{ code: 'CREATE_FAILED' }]
            });
            const app = createTestApp(designController, workerLoop);
            const res = await makeRequest(app, 'POST', '/v1/dag/dev/bootstrap', {});
            expect(res.status).toBe(400);
        });

        it('returns error when publish fails', async () => {
            designController.publishDefinition.mockResolvedValue({
                status: 400, ok: false, errors: [{ code: 'PUBLISH_FAILED' }]
            });
            const app = createTestApp(designController, workerLoop);
            const res = await makeRequest(app, 'POST', '/v1/dag/dev/bootstrap', {});
            expect(res.status).toBe(400);
        });
    });

    describe('POST /v1/dag/dev/llm-text/complete', () => {
        it('returns 500 when LLM client is not configured', async () => {
            const app = createTestApp(designController, workerLoop, undefined);
            const res = await makeRequest(app, 'POST', '/v1/dag/dev/llm-text/complete', {
                prompt: 'test'
            });
            expect(res.status).toBe(500);
            expect(res.body.errors[0].code).toBe('DAG_VALIDATION_LLM_CLIENT_NOT_CONFIGURED');
        });

        it('returns 400 when prompt is missing', async () => {
            const llmClient = createMockLlmClient();
            const app = createTestApp(designController, workerLoop, llmClient);
            const res = await makeRequest(app, 'POST', '/v1/dag/dev/llm-text/complete', {});
            expect(res.status).toBe(400);
            expect(res.body.errors[0].code).toBe('DAG_VALIDATION_LLM_PROMPT_REQUIRED');
        });

        it('returns 400 when temperature is invalid', async () => {
            const llmClient = createMockLlmClient();
            const app = createTestApp(designController, workerLoop, llmClient);
            const res = await makeRequest(app, 'POST', '/v1/dag/dev/llm-text/complete', {
                prompt: 'test',
                temperature: 'bad'
            });
            expect(res.status).toBe(400);
            expect(res.body.errors[0].code).toBe('DAG_VALIDATION_LLM_TEMPERATURE_INVALID');
        });

        it('returns 400 when maxTokens is invalid', async () => {
            const llmClient = createMockLlmClient();
            const app = createTestApp(designController, workerLoop, llmClient);
            const res = await makeRequest(app, 'POST', '/v1/dag/dev/llm-text/complete', {
                prompt: 'test',
                maxTokens: 'bad'
            });
            expect(res.status).toBe(400);
            expect(res.body.errors[0].code).toBe('DAG_VALIDATION_LLM_MAXTOKENS_INVALID');
        });

        it('returns 200 with completion on success', async () => {
            const llmClient = createMockLlmClient();
            const app = createTestApp(designController, workerLoop, llmClient);
            const res = await makeRequest(app, 'POST', '/v1/dag/dev/llm-text/complete', {
                prompt: 'test prompt'
            });
            expect(res.status).toBe(200);
            expect(res.body.data.completion).toBe('Generated text');
        });

        it('returns 400 when model selection fails', async () => {
            const llmClient = createMockLlmClient();
            (llmClient.resolveModelSelection as any).mockReturnValue({
                ok: false,
                error: { code: 'MODEL_NOT_FOUND', message: 'not found', category: 'validation', retryable: false }
            });
            const app = createTestApp(designController, workerLoop, llmClient);
            const res = await makeRequest(app, 'POST', '/v1/dag/dev/llm-text/complete', {
                prompt: 'test'
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when completion fails', async () => {
            const llmClient = createMockLlmClient();
            (llmClient.generateCompletion as any).mockResolvedValue({
                ok: false,
                error: { code: 'COMPLETION_FAILED', message: 'failed', category: 'task_execution', retryable: false }
            });
            const app = createTestApp(designController, workerLoop, llmClient);
            const res = await makeRequest(app, 'POST', '/v1/dag/dev/llm-text/complete', {
                prompt: 'test'
            });
            expect(res.status).toBe(400);
        });

        it('handles explicit provider and model', async () => {
            const llmClient = createMockLlmClient();
            const app = createTestApp(designController, workerLoop, llmClient);
            const res = await makeRequest(app, 'POST', '/v1/dag/dev/llm-text/complete', {
                prompt: 'test',
                provider: 'anthropic',
                model: 'claude-3'
            });
            expect(res.status).toBe(200);
            expect(llmClient.resolveModelSelection).toHaveBeenCalledWith({
                provider: 'anthropic',
                model: 'claude-3'
            });
        });
    });

    describe('POST /v1/dag/dev/workers/process-once', () => {
        it('returns 200 with processed result', async () => {
            const app = createTestApp(designController, workerLoop);
            const res = await makeRequest(app, 'POST', '/v1/dag/dev/workers/process-once', {});
            expect(res.status).toBe(200);
            expect(res.body.data.processed).toBe(true);
        });

        it('returns 500 when worker loop fails', async () => {
            workerLoop.processOnce.mockResolvedValue({
                ok: false,
                error: { code: 'WORKER_ERROR', message: 'error', category: 'task_execution', retryable: false }
            });
            const app = createTestApp(designController, workerLoop);
            const res = await makeRequest(app, 'POST', '/v1/dag/dev/workers/process-once', {});
            expect(res.status).toBe(500);
        });
    });
});
