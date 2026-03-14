import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import type { ICostMeta, ICostMetaStoragePort } from '@robota-sdk/dag-cost';
import { CelCostEvaluator } from '@robota-sdk/dag-cost';
import { registerCostMetaRoutes } from '../routes/cost-meta-routes.js';

// ---------------------------------------------------------------------------
// In-memory storage for tests (avoids filesystem)
// ---------------------------------------------------------------------------

class InMemoryCostMetaStorage implements ICostMetaStoragePort {
    private readonly store = new Map<string, ICostMeta>();

    async get(nodeType: string): Promise<ICostMeta | undefined> {
        return this.store.get(nodeType);
    }

    async getAll(): Promise<ICostMeta[]> {
        return Array.from(this.store.values());
    }

    async save(meta: ICostMeta): Promise<void> {
        this.store.set(meta.nodeType, meta);
    }

    async delete(nodeType: string): Promise<void> {
        this.store.delete(nodeType);
    }
}

// ---------------------------------------------------------------------------
// Test server setup
// ---------------------------------------------------------------------------

let server: http.Server;
let baseUrl: string;

function createTestApp(): express.Express {
    const app = express();
    app.use(express.json());

    const storage = new InMemoryCostMetaStorage();
    const evaluator = new CelCostEvaluator();
    registerCostMetaRoutes(app, storage, evaluator);

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

async function put(path: string, payload?: unknown): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: typeof payload !== 'undefined' ? JSON.stringify(payload) : undefined,
    });
    const body: unknown = await res.json();
    return { status: res.status, body };
}

async function del(path: string): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE' });
    const body: unknown = await res.json();
    return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createValidCostMeta(nodeType = 'llm-text-openai'): ICostMeta {
    return {
        nodeType,
        displayName: 'LLM Text OpenAI',
        category: 'ai-inference',
        estimateFormula: 'tokenCount * rate',
        variables: { rate: 0.01, tokenCount: 100 },
        enabled: true,
        updatedAt: new Date().toISOString(),
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cost-meta-routes', () => {
    describe('GET /v1/cost-meta', () => {
        it('returns empty array initially', async () => {
            const { status, body } = await get('/v1/cost-meta');

            expect(status).toBe(200);
            const envelope = body as { ok: boolean; data: unknown[] };
            expect(envelope.ok).toBe(true);
            expect(envelope.data).toEqual([]);
        });
    });

    describe('POST /v1/cost-meta', () => {
        it('creates and returns 201 with valid formula', async () => {
            const meta = createValidCostMeta();
            const { status, body } = await post('/v1/cost-meta', meta);

            expect(status).toBe(201);
            const envelope = body as { ok: boolean; data: ICostMeta };
            expect(envelope.ok).toBe(true);
            expect(envelope.data.nodeType).toBe('llm-text-openai');
        });

        it('returns 400 with invalid estimateFormula', async () => {
            const meta = createValidCostMeta('bad-node');
            meta.estimateFormula = '!!!invalid!!!';
            const { status, body } = await post('/v1/cost-meta', meta);

            expect(status).toBe(400);
            const envelope = body as { ok: boolean; error: string };
            expect(envelope.ok).toBe(false);
            expect(envelope.error).toContain('Invalid estimateFormula');
        });

        it('returns 400 with invalid calculateFormula', async () => {
            const meta = createValidCostMeta('bad-calc-node');
            meta.calculateFormula = '!!!invalid!!!';
            const { status, body } = await post('/v1/cost-meta', meta);

            expect(status).toBe(400);
            const envelope = body as { ok: boolean; error: string };
            expect(envelope.ok).toBe(false);
            expect(envelope.error).toContain('Invalid calculateFormula');
        });
    });

    describe('GET /v1/cost-meta/:nodeType', () => {
        it('returns the created meta', async () => {
            const { status, body } = await get('/v1/cost-meta/llm-text-openai');

            expect(status).toBe(200);
            const envelope = body as { ok: boolean; data: ICostMeta };
            expect(envelope.ok).toBe(true);
            expect(envelope.data.nodeType).toBe('llm-text-openai');
        });

        it('returns 404 for non-existent nodeType', async () => {
            const { status, body } = await get('/v1/cost-meta/nonexistent');

            expect(status).toBe(404);
            const envelope = body as { ok: boolean; error: string };
            expect(envelope.ok).toBe(false);
        });
    });

    describe('PUT /v1/cost-meta/:nodeType', () => {
        it('updates existing entry', async () => {
            const updated = createValidCostMeta('llm-text-openai');
            updated.displayName = 'Updated Name';
            const { status, body } = await put('/v1/cost-meta/llm-text-openai', updated);

            expect(status).toBe(200);
            const envelope = body as { ok: boolean; data: ICostMeta };
            expect(envelope.ok).toBe(true);
            expect(envelope.data.displayName).toBe('Updated Name');

            // Verify via GET
            const getResult = await get('/v1/cost-meta/llm-text-openai');
            const getEnvelope = getResult.body as { data: ICostMeta };
            expect(getEnvelope.data.displayName).toBe('Updated Name');
        });

        it('returns 400 with invalid formula', async () => {
            const meta = createValidCostMeta();
            meta.estimateFormula = '!!!bad!!!';
            const { status, body } = await put('/v1/cost-meta/llm-text-openai', meta);

            expect(status).toBe(400);
            const envelope = body as { ok: boolean };
            expect(envelope.ok).toBe(false);
        });
    });

    describe('DELETE /v1/cost-meta/:nodeType', () => {
        it('deletes existing entry', async () => {
            // Ensure it exists first
            await post('/v1/cost-meta', createValidCostMeta('to-delete'));
            const exists = await get('/v1/cost-meta/to-delete');
            expect(exists.status).toBe(200);

            // Delete
            const { status, body } = await del('/v1/cost-meta/to-delete');
            expect(status).toBe(200);
            const envelope = body as { ok: boolean };
            expect(envelope.ok).toBe(true);

            // Verify deleted
            const deleted = await get('/v1/cost-meta/to-delete');
            expect(deleted.status).toBe(404);
        });
    });

    describe('POST /v1/cost-meta/validate', () => {
        it('returns { ok: true } for valid formula', async () => {
            const { status, body } = await post('/v1/cost-meta/validate', {
                formula: 'a + b * 2',
            });

            expect(status).toBe(200);
            const envelope = body as { ok: boolean };
            expect(envelope.ok).toBe(true);
        });

        it('returns { ok: false, errors } for invalid formula', async () => {
            const { status, body } = await post('/v1/cost-meta/validate', {
                formula: '!!!invalid!!!',
            });

            expect(status).toBe(200);
            const envelope = body as { ok: boolean; errors: string[] };
            expect(envelope.ok).toBe(false);
            expect(Array.isArray(envelope.errors)).toBe(true);
            expect(envelope.errors.length).toBeGreaterThan(0);
        });
    });

    describe('POST /v1/cost-meta/preview', () => {
        it('returns calculated result', async () => {
            const { status, body } = await post('/v1/cost-meta/preview', {
                formula: 'baseCost + duration * perSec',
                variables: { baseCost: 8.0, perSec: 1.0 },
                testContext: { duration: 10 },
            });

            expect(status).toBe(200);
            const envelope = body as { ok: boolean; result: number };
            expect(envelope.ok).toBe(true);
            expect(envelope.result).toBe(18.0);
        });

        it('returns error for invalid formula', async () => {
            const { status, body } = await post('/v1/cost-meta/preview', {
                formula: '!!!bad!!!',
                variables: {},
                testContext: {},
            });

            expect(status).toBe(200);
            const envelope = body as { ok: boolean; error: string };
            expect(envelope.ok).toBe(false);
            expect(typeof envelope.error).toBe('string');
        });
    });
});
