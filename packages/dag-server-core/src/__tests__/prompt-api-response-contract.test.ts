import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { mountPromptRoutes } from '../routes/prompt-routes.js';
import { PromptApiController } from '@robota-sdk/dag-api';
import { createStubPromptBackend } from '@robota-sdk/dag-core';
import { PROMPT_API_OPENAPI_DOCUMENT } from '../docs/openapi-prompt-api.js';

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

type JsonObject = Record<string, unknown>;

/**
 * Validates that a response body conforms to a simplified OpenAPI schema shape.
 * Checks required fields and basic type matching.
 */
function validateResponseShape(
    body: unknown,
    schema: { type?: string; required?: readonly string[]; properties?: Record<string, { type?: string }> },
    context: string
): string[] {
    const errors: string[] = [];

    if (schema.type === 'object' && typeof body !== 'object') {
        errors.push(`${context}: expected object, got ${typeof body}`);
        return errors;
    }

    if (schema.required && typeof body === 'object' && body !== null) {
        const obj = body as JsonObject;
        for (const field of schema.required) {
            if (!(field in obj)) {
                errors.push(`${context}: missing required field "${field}"`);
            }
        }
    }

    if (schema.properties && typeof body === 'object' && body !== null) {
        const obj = body as JsonObject;
        for (const [field, fieldSchema] of Object.entries(schema.properties)) {
            if (field in obj && fieldSchema.type) {
                const value = obj[field];
                const expectedType = fieldSchema.type === 'integer' ? 'number' : fieldSchema.type;
                if (expectedType === 'array' && !Array.isArray(value)) {
                    errors.push(`${context}.${field}: expected array, got ${typeof value}`);
                } else if (expectedType !== 'array' && expectedType !== 'object' && typeof value !== expectedType) {
                    errors.push(`${context}.${field}: expected ${expectedType}, got ${typeof value}`);
                }
            }
        }
    }

    return errors;
}

describe('Prompt API response contract (responses match OpenAPI spec)', () => {
    let app: express.Express;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        mountPromptRoutes(app, new PromptApiController(createStubPromptBackend()));
    });

    it('POST /prompt 200 response matches spec schema', async () => {
        const res = await makeRequest(app, 'POST', '/prompt', {
            prompt: { '1': { class_type: 'TestNode', inputs: {} } },
        });
        expect(res.status).toBe(200);

        const specSchema = PROMPT_API_OPENAPI_DOCUMENT.paths['/prompt'].post
            .responses['200'].content['application/json'].schema;

        const errors = validateResponseShape(res.body, specSchema, 'POST /prompt 200');
        expect(errors).toEqual([]);
    });

    it('POST /prompt 400 response matches spec error schema', async () => {
        const res = await makeRequest(app, 'POST', '/prompt', { prompt: {} });
        expect(res.status).toBe(400);

        const specSchema = PROMPT_API_OPENAPI_DOCUMENT.paths['/prompt'].post
            .responses['400'].content['application/json'].schema;

        const errors = validateResponseShape(res.body, specSchema, 'POST /prompt 400');
        expect(errors).toEqual([]);
    });

    it('GET /queue 200 response matches spec schema', async () => {
        const res = await makeRequest(app, 'GET', '/queue');
        expect(res.status).toBe(200);

        const specSchema = PROMPT_API_OPENAPI_DOCUMENT.paths['/queue'].get
            .responses['200'].content['application/json'].schema;

        const errors = validateResponseShape(res.body, specSchema, 'GET /queue 200');
        expect(errors).toEqual([]);
    });

    it('GET /object_info 200 response is an object of node definitions', async () => {
        const res = await makeRequest(app, 'GET', '/object_info');
        expect(res.status).toBe(200);
        expect(typeof res.body).toBe('object');
        expect(res.body).not.toBeNull();

        // Each value should be a node definition object
        const body = res.body as JsonObject;
        for (const [nodeType, nodeDef] of Object.entries(body)) {
            expect(typeof nodeDef).toBe('object');
            const def = nodeDef as JsonObject;
            expect(def).toHaveProperty('display_name');
            expect(def).toHaveProperty('category');
            expect(def).toHaveProperty('input');
            expect(def).toHaveProperty('output');
            expect(def).toHaveProperty('output_name');
        }
    });

    it('GET /system_stats 200 response matches spec schema', async () => {
        const res = await makeRequest(app, 'GET', '/system_stats');
        expect(res.status).toBe(200);

        const specSchema = PROMPT_API_OPENAPI_DOCUMENT.paths['/system_stats'].get
            .responses['200'].content['application/json'].schema;

        const errors = validateResponseShape(res.body, specSchema, 'GET /system_stats 200');
        expect(errors).toEqual([]);
    });

    it('GET /history 200 response is an object', async () => {
        const res = await makeRequest(app, 'GET', '/history');
        expect(res.status).toBe(200);
        expect(typeof res.body).toBe('object');
    });

    it('GET /history/:prompt_id 200 response is an object', async () => {
        const res = await makeRequest(app, 'GET', '/history/some-prompt-id');
        expect(res.status).toBe(200);
        expect(typeof res.body).toBe('object');
    });
});
