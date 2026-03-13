import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import { DAG_OPENAPI_DOCUMENT } from '../docs/openapi-dag.js';
import { PROMPT_API_OPENAPI_DOCUMENT } from '../docs/openapi-prompt-api.js';
import { registerDefinitionRoutes } from '../routes/definition-routes.js';
import { registerRunRoutes } from '../routes/run-routes.js';
import { registerAssetRoutes } from '../routes/asset-routes.js';
import { registerSseRoutes } from '../routes/sse-routes.js';
import { registerDevRoutes } from '../routes/dev-routes.js';
import { mountPromptRoutes } from '../routes/prompt-routes.js';
import type { IAssetStore, IAssetContentResult, IStoredAssetMetadata } from '../asset-store-contract.js';
import type { IClockPort } from '@robota-sdk/dag-core';

/**
 * Converts OpenAPI path parameters `{param}` to Express `:param` format.
 */
function openApiPathToExpress(openApiPath: string): string {
    return openApiPath.replace(/\{(\w+)}/g, ':$1');
}

/**
 * Extracts registered routes from an Express app/router.
 * Returns a Set of `METHOD /path` strings (e.g., "GET /v1/dag/runs/:dagRunId").
 */
function extractExpressRoutes(app: express.Express): Set<string> {
    const routes = new Set<string>();
    const stack = app._router?.stack ?? [];

    for (const layer of stack) {
        if (layer.route) {
            const path: string = layer.route.path;
            const methods = Object.keys(layer.route.methods);
            for (const method of methods) {
                routes.add(`${method.toUpperCase()} ${path}`);
            }
        }
        if (layer.name === 'router' && layer.handle?.stack) {
            for (const routerLayer of layer.handle.stack) {
                if (routerLayer.route) {
                    const path: string = routerLayer.route.path;
                    const methods = Object.keys(routerLayer.route.methods);
                    for (const method of methods) {
                        routes.add(`${method.toUpperCase()} ${path}`);
                    }
                }
            }
        }
    }

    return routes;
}

/**
 * Extracts all method+path pairs from an OpenAPI document.
 */
function extractOpenApiRoutes(doc: { paths: Record<string, Record<string, unknown>> }): Set<string> {
    const routes = new Set<string>();
    const httpMethods = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);

    for (const [path, methods] of Object.entries(doc.paths)) {
        const expressPath = openApiPathToExpress(path);
        for (const method of Object.keys(methods)) {
            if (httpMethods.has(method)) {
                routes.add(`${method.toUpperCase()} ${expressPath}`);
            }
        }
    }

    return routes;
}

// Stub implementations for DI — only used to register routes, never called
const NOOP_ASYNC = async () => ({ ok: true as const, status: 200, data: {} });
const stubDesignController = new Proxy({}, { get: () => NOOP_ASYNC }) as Parameters<typeof registerDefinitionRoutes>[1];
const stubDagRunService = new Proxy({}, { get: () => NOOP_ASYNC }) as Parameters<typeof registerRunRoutes>[1];
const stubRuntimeController = new Proxy({}, { get: () => NOOP_ASYNC }) as Parameters<typeof registerRunRoutes>[2];
const stubObservabilityController = new Proxy({}, { get: () => NOOP_ASYNC }) as Parameters<typeof registerRunRoutes>[3];
const stubAssetStore: IAssetStore = {
    save: async () => ({ assetId: '', fileName: '', mediaType: '', sizeBytes: 0, createdAt: '' }),
    saveReference: async () => ({ assetId: '', fileName: '', mediaType: '', sizeBytes: 0, createdAt: '' }),
    getMetadata: async (): Promise<IStoredAssetMetadata | undefined> => undefined,
    getContent: async (): Promise<IAssetContentResult | undefined> => undefined,
};
const stubPromptController = new Proxy({}, { get: () => NOOP_ASYNC }) as Parameters<typeof mountPromptRoutes>[1];
const stubWorkerLoop = new Proxy({}, { get: () => NOOP_ASYNC }) as Parameters<typeof registerDevRoutes>[2];
const stubSseClients = new Map<string, Set<express.Response>>();
const stubRunQuery = NOOP_ASYNC as unknown as Parameters<typeof registerSseRoutes>[2];
const stubClock: IClockPort = { nowIso: () => new Date().toISOString(), nowEpochMs: () => Date.now() };
const SSE_KEEPALIVE_MS = 30000;

describe('OpenAPI spec ↔ route implementation contract', () => {
    let dagRoutes: Set<string>;
    let promptRoutes: Set<string>;
    let dagSpecRoutes: Set<string>;
    let promptSpecRoutes: Set<string>;

    beforeAll(() => {
        // Register all DAG routes
        const dagApp = express();
        const router = express.Router();
        registerDefinitionRoutes(router, stubDesignController, stubAssetStore);
        registerRunRoutes(router, stubDagRunService, stubRuntimeController, stubObservabilityController, stubAssetStore);
        registerAssetRoutes(router, stubAssetStore);
        registerSseRoutes(router, stubSseClients, stubRunQuery, stubClock, SSE_KEEPALIVE_MS);
        registerDevRoutes(router, stubDesignController, stubWorkerLoop, undefined);
        dagApp.use(router);
        dagRoutes = extractExpressRoutes(dagApp);

        // Register all Prompt API routes
        const promptApp = express();
        mountPromptRoutes(promptApp, stubPromptController);
        promptRoutes = extractExpressRoutes(promptApp);

        // Extract spec routes
        dagSpecRoutes = extractOpenApiRoutes(DAG_OPENAPI_DOCUMENT);
        promptSpecRoutes = extractOpenApiRoutes(PROMPT_API_OPENAPI_DOCUMENT);
    });

    describe('DAG API: every spec path has a matching route', () => {
        it('should have route implementations for all spec paths', () => {
            const missingRoutes: string[] = [];
            for (const specRoute of dagSpecRoutes) {
                if (!dagRoutes.has(specRoute)) {
                    missingRoutes.push(specRoute);
                }
            }
            expect(missingRoutes).toEqual([]);
        });

        it('should not have undocumented routes (routes without spec entries)', () => {
            const undocumentedRoutes: string[] = [];
            for (const implRoute of dagRoutes) {
                if (!dagSpecRoutes.has(implRoute)) {
                    undocumentedRoutes.push(implRoute);
                }
            }
            expect(undocumentedRoutes).toEqual([]);
        });
    });

    describe('Prompt API: every spec path has a matching route', () => {
        it('should have route implementations for all spec paths', () => {
            const missingRoutes: string[] = [];
            for (const specRoute of promptSpecRoutes) {
                if (!promptRoutes.has(specRoute)) {
                    missingRoutes.push(specRoute);
                }
            }
            expect(missingRoutes).toEqual([]);
        });

        it('should not have undocumented routes (routes without spec entries)', () => {
            const undocumentedRoutes: string[] = [];
            for (const implRoute of promptRoutes) {
                if (!promptSpecRoutes.has(implRoute)) {
                    undocumentedRoutes.push(implRoute);
                }
            }
            expect(undocumentedRoutes).toEqual([]);
        });
    });

    describe('OpenAPI spec structural integrity', () => {
        it('DAG API spec should use version 3.0.3', () => {
            expect(DAG_OPENAPI_DOCUMENT.openapi).toBe('3.0.3');
        });

        it('Prompt API spec should use version 3.0.3', () => {
            expect(PROMPT_API_OPENAPI_DOCUMENT.openapi).toBe('3.0.3');
        });

        it('DAG API spec should define ProblemDetails schema', () => {
            expect(DAG_OPENAPI_DOCUMENT.components.schemas.ProblemDetails).toBeDefined();
            expect(DAG_OPENAPI_DOCUMENT.components.schemas.ProblemDetails.required).toContain('type');
            expect(DAG_OPENAPI_DOCUMENT.components.schemas.ProblemDetails.required).toContain('status');
            expect(DAG_OPENAPI_DOCUMENT.components.schemas.ProblemDetails.required).toContain('detail');
        });

        it('DAG API spec should define Success and Error envelopes', () => {
            expect(DAG_OPENAPI_DOCUMENT.components.schemas.SuccessEnvelope).toBeDefined();
            expect(DAG_OPENAPI_DOCUMENT.components.schemas.ErrorEnvelope).toBeDefined();
            expect(DAG_OPENAPI_DOCUMENT.components.schemas.SuccessEnvelope.required).toContain('ok');
            expect(DAG_OPENAPI_DOCUMENT.components.schemas.SuccessEnvelope.required).toContain('data');
            expect(DAG_OPENAPI_DOCUMENT.components.schemas.ErrorEnvelope.required).toContain('ok');
            expect(DAG_OPENAPI_DOCUMENT.components.schemas.ErrorEnvelope.required).toContain('errors');
        });

        it('every DAG API spec path should have at least one response defined', () => {
            for (const [path, methods] of Object.entries(DAG_OPENAPI_DOCUMENT.paths)) {
                for (const [method, operation] of Object.entries(methods as Record<string, { responses?: Record<string, unknown> }>)) {
                    if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
                        expect(
                            operation.responses,
                            `${method.toUpperCase()} ${path} should have responses`
                        ).toBeDefined();
                        expect(
                            Object.keys(operation.responses!).length,
                            `${method.toUpperCase()} ${path} should have at least one response`
                        ).toBeGreaterThan(0);
                    }
                }
            }
        });

        it('every Prompt API spec path should have at least one response defined', () => {
            for (const [path, methods] of Object.entries(PROMPT_API_OPENAPI_DOCUMENT.paths)) {
                for (const [method, operation] of Object.entries(methods as Record<string, { responses?: Record<string, unknown> }>)) {
                    if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
                        expect(
                            operation.responses,
                            `${method.toUpperCase()} ${path} should have responses`
                        ).toBeDefined();
                        expect(
                            Object.keys(operation.responses!).length,
                            `${method.toUpperCase()} ${path} should have at least one response`
                        ).toBeGreaterThan(0);
                    }
                }
            }
        });
    });

    describe('OpenAPI spec operationId uniqueness', () => {
        it('DAG API should have unique operationIds', () => {
            const ids: string[] = [];
            for (const methods of Object.values(DAG_OPENAPI_DOCUMENT.paths)) {
                for (const [method, operation] of Object.entries(methods as Record<string, { operationId?: string }>)) {
                    if (['get', 'post', 'put', 'delete', 'patch'].includes(method) && operation.operationId) {
                        ids.push(operation.operationId);
                    }
                }
            }
            const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
            expect(duplicates).toEqual([]);
        });

        it('Prompt API should have unique operationIds', () => {
            const ids: string[] = [];
            for (const methods of Object.values(PROMPT_API_OPENAPI_DOCUMENT.paths)) {
                for (const [method, operation] of Object.entries(methods as Record<string, { operationId?: string }>)) {
                    if (['get', 'post', 'put', 'delete', 'patch'].includes(method) && operation.operationId) {
                        ids.push(operation.operationId);
                    }
                }
            }
            const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
            expect(duplicates).toEqual([]);
        });
    });
});
