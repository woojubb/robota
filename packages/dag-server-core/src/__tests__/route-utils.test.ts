import { describe, expect, it, vi } from 'vitest';
import {
    createCorrelationId,
    resolveCorrelationId,
    toAssetReference,
    getAssetContentUri,
    toRunProblemDetails,
    validateAssetReferences,
    parseOptionalPositiveIntegerQuery,
    parseTaskRunPayloadSnapshot,
    DEFAULT_PORT,
    DEFAULT_CORS_ORIGINS,
    DEFAULT_REQUEST_BODY_LIMIT,
    DEFAULT_WORKER_TIMEOUT_MS,
    DEFAULT_SSE_KEEP_ALIVE_MS,
    HTTP_BAD_REQUEST,
    HTTP_NOT_FOUND,
    HTTP_CREATED,
    HTTP_ACCEPTED,
    HTTP_OK,
    HTTP_CONFLICT,
    HTTP_INTERNAL_SERVER_ERROR
} from '../routes/route-utils.js';
import type { IAssetStore, IStoredAssetMetadata } from '../asset-store-contract.js';
import type { IDagDefinition } from '@robota-sdk/dag-core';

describe('route-utils', () => {
    describe('constants', () => {
        it('exports expected default values', () => {
            expect(DEFAULT_PORT).toBe(3011);
            expect(DEFAULT_CORS_ORIGINS).toEqual(['http://localhost:3000']);
            expect(DEFAULT_REQUEST_BODY_LIMIT).toBe('15mb');
            expect(DEFAULT_WORKER_TIMEOUT_MS).toBe(30_000);
            expect(DEFAULT_SSE_KEEP_ALIVE_MS).toBe(15_000);
        });

        it('exports expected HTTP status codes', () => {
            expect(HTTP_BAD_REQUEST).toBe(400);
            expect(HTTP_NOT_FOUND).toBe(404);
            expect(HTTP_CREATED).toBe(201);
            expect(HTTP_ACCEPTED).toBe(202);
            expect(HTTP_OK).toBe(200);
            expect(HTTP_CONFLICT).toBe(409);
            expect(HTTP_INTERNAL_SERVER_ERROR).toBe(500);
        });
    });

    describe('createCorrelationId', () => {
        it('creates a correlation ID with the given scope prefix', () => {
            const id = createCorrelationId('test-scope');
            expect(id).toMatch(/^test-scope:/);
            // Format: scope:timestamp_base36:random_base36
            const parts = id.split(':');
            expect(parts.length).toBeGreaterThanOrEqual(3);
        });
    });

    describe('resolveCorrelationId', () => {
        it('returns header value when x-correlation-id is present', () => {
            const req = { get: vi.fn().mockReturnValue('custom-id') };
            const result = resolveCorrelationId(req, 'fallback');
            expect(result).toBe('custom-id');
        });

        it('trims whitespace from header value', () => {
            const req = { get: vi.fn().mockReturnValue('  id-with-spaces  ') };
            const result = resolveCorrelationId(req, 'fallback');
            expect(result).toBe('id-with-spaces');
        });

        it('generates a new correlation ID when header is missing', () => {
            const req = { get: vi.fn().mockReturnValue(undefined) };
            const result = resolveCorrelationId(req, 'test-scope');
            expect(result).toMatch(/^test-scope:/);
        });

        it('generates a new correlation ID when header is empty', () => {
            const req = { get: vi.fn().mockReturnValue('   ') };
            const result = resolveCorrelationId(req, 'test-scope');
            expect(result).toMatch(/^test-scope:/);
        });
    });

    describe('toAssetReference', () => {
        it('converts stored metadata to API response shape', () => {
            const metadata: IStoredAssetMetadata = {
                assetId: 'asset-123',
                fileName: 'test.png',
                mediaType: 'image/png',
                sizeBytes: 1024,
                createdAt: '2026-01-01T00:00:00.000Z'
            };
            const result = toAssetReference(metadata, 'https://host/v1/dag/assets/asset-123/content');

            expect(result).toEqual({
                referenceType: 'asset',
                assetId: 'asset-123',
                mediaType: 'image/png',
                uri: 'https://host/v1/dag/assets/asset-123/content',
                name: 'test.png',
                sizeBytes: 1024
            });
        });
    });

    describe('getAssetContentUri', () => {
        it('builds content URI from request context', () => {
            const req = {
                protocol: 'https',
                get: vi.fn().mockReturnValue('example.com')
            };
            const result = getAssetContentUri(req, 'asset-123');
            expect(result).toBe('https://example.com/v1/dag/assets/asset-123/content');
        });
    });

    describe('toRunProblemDetails', () => {
        it('converts validation error to problem details', () => {
            const result = toRunProblemDetails(
                { code: 'DAG_VALIDATION_TEST', detail: 'test detail', retryable: false },
                '/v1/dag/runs'
            );

            expect(result).toEqual({
                type: 'urn:robota:problems:dag:validation',
                title: 'DAG validation failed',
                status: 400,
                detail: 'test detail',
                instance: '/v1/dag/runs',
                code: 'DAG_VALIDATION_TEST',
                retryable: false
            });
        });
    });

    describe('validateAssetReferences', () => {
        function createMockAssetStore(metadata?: IStoredAssetMetadata): IAssetStore {
            return {
                save: vi.fn(),
                saveReference: vi.fn(),
                getMetadata: vi.fn().mockResolvedValue(metadata),
                getContent: vi.fn()
            };
        }

        it('returns empty array for nodes without asset config', async () => {
            const definition: IDagDefinition = {
                dagId: 'dag-1', version: 1, status: 'draft',
                nodes: [{ nodeId: 'n1', nodeType: 'test', dependsOn: [], inputs: [], outputs: [], config: {} }],
                edges: []
            };
            const errors = await validateAssetReferences(definition, createMockAssetStore());
            expect(errors).toEqual([]);
        });

        it('returns error when asset is not an object', async () => {
            const definition: IDagDefinition = {
                dagId: 'dag-1', version: 1, status: 'draft',
                nodes: [{ nodeId: 'n1', nodeType: 'test', dependsOn: [], inputs: [], outputs: [], config: { asset: 'bad' } }],
                edges: []
            };
            const errors = await validateAssetReferences(definition, createMockAssetStore());
            expect(errors).toHaveLength(1);
            expect(errors[0].code).toBe('DAG_VALIDATION_ASSET_REFERENCE_OBJECT_REQUIRED');
        });

        it('returns error for invalid referenceType', async () => {
            const definition: IDagDefinition = {
                dagId: 'dag-1', version: 1, status: 'draft',
                nodes: [{
                    nodeId: 'n1', nodeType: 'test', dependsOn: [], inputs: [], outputs: [],
                    config: { asset: { referenceType: 'invalid' } }
                }],
                edges: []
            };
            const errors = await validateAssetReferences(definition, createMockAssetStore());
            expect(errors).toHaveLength(1);
            expect(errors[0].code).toBe('DAG_VALIDATION_ASSET_REFERENCE_TYPE_INVALID');
        });

        it('returns error when both assetId and uri are provided', async () => {
            const definition: IDagDefinition = {
                dagId: 'dag-1', version: 1, status: 'draft',
                nodes: [{
                    nodeId: 'n1', nodeType: 'test', dependsOn: [], inputs: [], outputs: [],
                    config: { asset: { referenceType: 'asset', assetId: 'a1', uri: 'http://example.com' } }
                }],
                edges: []
            };
            const errors = await validateAssetReferences(definition, createMockAssetStore());
            expect(errors).toHaveLength(1);
            expect(errors[0].code).toBe('DAG_VALIDATION_ASSET_REFERENCE_XOR_REQUIRED');
        });

        it('returns error when neither assetId nor uri are provided', async () => {
            // When both are missing, hasAssetId === hasUri (both false), so XOR check triggers first
            const definition: IDagDefinition = {
                dagId: 'dag-1', version: 1, status: 'draft',
                nodes: [{
                    nodeId: 'n1', nodeType: 'test', dependsOn: [], inputs: [], outputs: [],
                    config: { asset: { referenceType: 'asset' } }
                }],
                edges: []
            };
            const errors = await validateAssetReferences(definition, createMockAssetStore());
            expect(errors).toHaveLength(1);
            expect(errors[0].code).toBe('DAG_VALIDATION_ASSET_REFERENCE_XOR_REQUIRED');
        });

        it('returns error when referenceType is uri but only assetId is provided (asset-requires check)', async () => {
            // hasAssetId=true, hasUri=false -> XOR passes (exactly one)
            // But referenceType=uri and !hasUri -> triggers URI_REQUIRES_URI
            const definition: IDagDefinition = {
                dagId: 'dag-1', version: 1, status: 'draft',
                nodes: [{
                    nodeId: 'n1', nodeType: 'test', dependsOn: [], inputs: [], outputs: [],
                    config: { asset: { referenceType: 'uri', assetId: 'a1' } }
                }],
                edges: []
            };
            const errors = await validateAssetReferences(definition, createMockAssetStore());
            expect(errors).toHaveLength(1);
            expect(errors[0].code).toBe('DAG_VALIDATION_ASSET_REFERENCE_TYPE_URI_REQUIRES_URI');
        });

        it('returns error when referenceType is asset but only uri is provided', async () => {
            // hasAssetId=false, hasUri=true -> XOR passes
            // But referenceType=asset and !hasAssetId -> triggers ASSET_REQUIRES_ASSET_ID
            const definition: IDagDefinition = {
                dagId: 'dag-1', version: 1, status: 'draft',
                nodes: [{
                    nodeId: 'n1', nodeType: 'test', dependsOn: [], inputs: [], outputs: [],
                    config: { asset: { referenceType: 'asset', uri: 'https://example.com' } }
                }],
                edges: []
            };
            const errors = await validateAssetReferences(definition, createMockAssetStore());
            expect(errors).toHaveLength(1);
            expect(errors[0].code).toBe('DAG_VALIDATION_ASSET_REFERENCE_TYPE_ASSET_REQUIRES_ASSET_ID');
        });

        it('returns error when referenced assetId is not found', async () => {
            const definition: IDagDefinition = {
                dagId: 'dag-1', version: 1, status: 'draft',
                nodes: [{
                    nodeId: 'n1', nodeType: 'test', dependsOn: [], inputs: [], outputs: [],
                    config: { asset: { referenceType: 'asset', assetId: 'unknown' } }
                }],
                edges: []
            };
            const store = createMockAssetStore(undefined);
            const errors = await validateAssetReferences(definition, store);
            expect(errors).toHaveLength(1);
            expect(errors[0].code).toBe('DAG_VALIDATION_ASSET_REFERENCE_NOT_FOUND');
        });

        it('returns no error when referenced assetId exists', async () => {
            const metadata: IStoredAssetMetadata = {
                assetId: 'a1', fileName: 'test.png', mediaType: 'image/png',
                sizeBytes: 100, createdAt: '2026-01-01T00:00:00.000Z'
            };
            const definition: IDagDefinition = {
                dagId: 'dag-1', version: 1, status: 'draft',
                nodes: [{
                    nodeId: 'n1', nodeType: 'test', dependsOn: [], inputs: [], outputs: [],
                    config: { asset: { referenceType: 'asset', assetId: 'a1' } }
                }],
                edges: []
            };
            const errors = await validateAssetReferences(definition, createMockAssetStore(metadata));
            expect(errors).toEqual([]);
        });

        it('passes for uri reference type with valid uri', async () => {
            const definition: IDagDefinition = {
                dagId: 'dag-1', version: 1, status: 'draft',
                nodes: [{
                    nodeId: 'n1', nodeType: 'test', dependsOn: [], inputs: [], outputs: [],
                    config: { asset: { referenceType: 'uri', uri: 'https://example.com/img.png' } }
                }],
                edges: []
            };
            const errors = await validateAssetReferences(definition, createMockAssetStore());
            expect(errors).toEqual([]);
        });

        it('returns error when asset is null', async () => {
            const definition: IDagDefinition = {
                dagId: 'dag-1', version: 1, status: 'draft',
                nodes: [{
                    nodeId: 'n1', nodeType: 'test', dependsOn: [], inputs: [], outputs: [],
                    config: { asset: null as any }
                }],
                edges: []
            };
            const errors = await validateAssetReferences(definition, createMockAssetStore());
            expect(errors).toHaveLength(1);
            expect(errors[0].code).toBe('DAG_VALIDATION_ASSET_REFERENCE_OBJECT_REQUIRED');
        });

        it('returns error when asset is an array', async () => {
            const definition: IDagDefinition = {
                dagId: 'dag-1', version: 1, status: 'draft',
                nodes: [{
                    nodeId: 'n1', nodeType: 'test', dependsOn: [], inputs: [], outputs: [],
                    config: { asset: ['bad'] as any }
                }],
                edges: []
            };
            const errors = await validateAssetReferences(definition, createMockAssetStore());
            expect(errors).toHaveLength(1);
            expect(errors[0].code).toBe('DAG_VALIDATION_ASSET_REFERENCE_OBJECT_REQUIRED');
        });
    });

    describe('parseOptionalPositiveIntegerQuery (extended)', () => {
        it('returns ok with undefined for empty string', () => {
            const result = parseOptionalPositiveIntegerQuery('');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toBeUndefined();
            }
        });

        it('returns ok with undefined for whitespace only', () => {
            const result = parseOptionalPositiveIntegerQuery('   ');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toBeUndefined();
            }
        });

        it('returns error for negative value string', () => {
            const result = parseOptionalPositiveIntegerQuery('-5');
            expect(result.ok).toBe(false);
        });

        it('returns error for floating point string', () => {
            const result = parseOptionalPositiveIntegerQuery('1.5');
            expect(result.ok).toBe(false);
        });
    });

    describe('parseTaskRunPayloadSnapshot (extended)', () => {
        it('returns undefined for empty string', () => {
            expect(parseTaskRunPayloadSnapshot('')).toBeUndefined();
        });

        it('returns undefined for numeric JSON', () => {
            expect(parseTaskRunPayloadSnapshot('42')).toBeUndefined();
        });

        it('returns undefined for null JSON', () => {
            expect(parseTaskRunPayloadSnapshot('null')).toBeUndefined();
        });

        it('returns parsed object for nested JSON', () => {
            const result = parseTaskRunPayloadSnapshot('{"nested":{"key":"value"}}');
            expect(result).toEqual({ nested: { key: 'value' } });
        });
    });
});
