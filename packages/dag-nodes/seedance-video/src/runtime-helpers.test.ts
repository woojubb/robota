import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRuntimeBaseUrl, toOutputVideo, resolveImageInputSource } from './runtime-helpers.js';
import type { IPortBinaryValue } from '@robota-sdk/dag-core';

describe('resolveRuntimeBaseUrl', () => {
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        savedEnv = { ...process.env };
        delete process.env.DAG_RUNTIME_BASE_URL;
        delete process.env.DAG_PORT;
    });

    afterEach(() => {
        process.env = savedEnv;
    });

    it('returns DAG_RUNTIME_BASE_URL when set', () => {
        process.env.DAG_RUNTIME_BASE_URL = 'https://my-runtime.example.com';
        expect(resolveRuntimeBaseUrl()).toBe('https://my-runtime.example.com');
    });

    it('strips trailing slash from DAG_RUNTIME_BASE_URL', () => {
        process.env.DAG_RUNTIME_BASE_URL = 'https://my-runtime.example.com/';
        expect(resolveRuntimeBaseUrl()).toBe('https://my-runtime.example.com');
    });

    it('strips trailing slash even with path segments', () => {
        process.env.DAG_RUNTIME_BASE_URL = 'https://host.com/api/v1/';
        expect(resolveRuntimeBaseUrl()).toBe('https://host.com/api/v1');
    });

    it('ignores whitespace-only DAG_RUNTIME_BASE_URL', () => {
        process.env.DAG_RUNTIME_BASE_URL = '   ';
        expect(resolveRuntimeBaseUrl()).toBe('http://127.0.0.1:3011');
    });

    it('returns http://127.0.0.1:{port} when only DAG_PORT is set', () => {
        process.env.DAG_PORT = '4000';
        expect(resolveRuntimeBaseUrl()).toBe('http://127.0.0.1:4000');
    });

    it('returns default http://127.0.0.1:3011 when no env vars are set', () => {
        expect(resolveRuntimeBaseUrl()).toBe('http://127.0.0.1:3011');
    });

    it('falls back to default port when DAG_PORT is not a valid number', () => {
        process.env.DAG_PORT = 'abc';
        expect(resolveRuntimeBaseUrl()).toBe('http://127.0.0.1:3011');
    });

    it('falls back to default port when DAG_PORT is zero', () => {
        process.env.DAG_PORT = '0';
        expect(resolveRuntimeBaseUrl()).toBe('http://127.0.0.1:3011');
    });

    it('falls back to default port when DAG_PORT is negative', () => {
        process.env.DAG_PORT = '-1';
        expect(resolveRuntimeBaseUrl()).toBe('http://127.0.0.1:3011');
    });

    it('prefers DAG_RUNTIME_BASE_URL over DAG_PORT', () => {
        process.env.DAG_RUNTIME_BASE_URL = 'https://preferred.example.com';
        process.env.DAG_PORT = '9999';
        expect(resolveRuntimeBaseUrl()).toBe('https://preferred.example.com');
    });
});

describe('toOutputVideo', () => {
    it('returns error when output is undefined', () => {
        const result = toOutputVideo(undefined);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_OUTPUT_MISSING');
        }
    });

    it('returns ok with asset reference for asset kind with valid assetId', () => {
        const result = toOutputVideo({
            kind: 'asset',
            assetId: 'vid-001',
            mimeType: 'video/mp4',
            bytes: 1024
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toEqual({
                kind: 'video',
                mimeType: 'video/mp4',
                uri: 'asset://vid-001',
                referenceType: 'asset',
                assetId: 'vid-001',
                sizeBytes: 1024
            });
        }
    });

    it('returns error for asset kind with missing assetId', () => {
        const result = toOutputVideo({
            kind: 'asset',
            mimeType: 'video/mp4'
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_OUTPUT_ASSET_INVALID');
        }
    });

    it('returns error for asset kind with empty assetId', () => {
        const result = toOutputVideo({
            kind: 'asset',
            assetId: '   ',
            mimeType: 'video/mp4'
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_OUTPUT_ASSET_INVALID');
        }
    });

    it('returns ok with uri reference for uri kind with valid uri', () => {
        const result = toOutputVideo({
            kind: 'uri',
            uri: 'https://cdn.example.com/video.mp4',
            mimeType: 'video/webm',
            bytes: 2048
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toEqual({
                kind: 'video',
                mimeType: 'video/webm',
                uri: 'https://cdn.example.com/video.mp4',
                referenceType: 'uri',
                sizeBytes: 2048
            });
        }
    });

    it('returns error for uri kind with missing uri', () => {
        const result = toOutputVideo({
            kind: 'uri',
            mimeType: 'video/mp4'
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_OUTPUT_URI_INVALID');
        }
    });

    it('returns error for uri kind with empty uri', () => {
        const result = toOutputVideo({
            kind: 'uri',
            uri: '   ',
            mimeType: 'video/mp4'
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_TASK_EXECUTION_SEEDANCE_OUTPUT_URI_INVALID');
        }
    });

    it('defaults mimeType to video/mp4 when not provided', () => {
        const result = toOutputVideo({
            kind: 'uri',
            uri: 'https://cdn.example.com/video.mp4'
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.mimeType).toBe('video/mp4');
        }
    });

    it('defaults mimeType to video/mp4 when mimeType is empty string', () => {
        const result = toOutputVideo({
            kind: 'uri',
            uri: 'https://cdn.example.com/video.mp4',
            mimeType: '   '
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.mimeType).toBe('video/mp4');
        }
    });

    it('preserves custom mimeType when provided', () => {
        const result = toOutputVideo({
            kind: 'asset',
            assetId: 'vid-002',
            mimeType: 'video/quicktime'
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.mimeType).toBe('video/quicktime');
        }
    });

    it('handles undefined bytes gracefully', () => {
        const result = toOutputVideo({
            kind: 'uri',
            uri: 'https://cdn.example.com/video.mp4'
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.sizeBytes).toBeUndefined();
        }
    });
});

describe('resolveImageInputSource', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('resolves asset reference by fetching content and returning inline base64', async () => {
        const imageBytes = new Uint8Array([137, 80, 78, 71]); // PNG header bytes
        mockFetch.mockResolvedValue({
            ok: true,
            body: true,
            headers: new Headers({ 'content-type': 'image/png' }),
            arrayBuffer: async () => imageBytes.buffer
        });
        const image: IPortBinaryValue = {
            kind: 'image',
            mimeType: 'image/png',
            uri: 'asset://img-001',
            referenceType: 'asset',
            assetId: 'img-001'
        };
        const result = await resolveImageInputSource(image, 'http://127.0.0.1:3011');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.kind).toBe('inline');
            if (result.value.kind === 'inline') {
                expect(result.value.mimeType).toBe('image/png');
                expect(typeof result.value.data).toBe('string');
            }
        }
        expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:3011/view?filename=img-001');
    });

    it('returns error when asset fetch fails (404)', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            body: null,
            headers: new Headers(),
            arrayBuffer: async () => new ArrayBuffer(0)
        });
        const image: IPortBinaryValue = {
            kind: 'image',
            mimeType: 'image/png',
            uri: 'asset://missing-asset',
            referenceType: 'asset',
            assetId: 'missing-asset'
        };
        const result = await resolveImageInputSource(image, 'http://127.0.0.1:3011');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_IMAGE_ASSET_NOT_FOUND');
        }
    });

    it('returns error when asset response has no body', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            body: null,
            headers: new Headers({ 'content-type': 'image/png' }),
            arrayBuffer: async () => new ArrayBuffer(0)
        });
        const image: IPortBinaryValue = {
            kind: 'image',
            mimeType: 'image/png',
            uri: 'asset://img-002',
            referenceType: 'asset',
            assetId: 'img-002'
        };
        const result = await resolveImageInputSource(image, 'http://127.0.0.1:3011');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_IMAGE_ASSET_NOT_FOUND');
        }
    });

    it('returns error when asset content-type is not an image', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            body: true,
            headers: new Headers({ 'content-type': 'application/octet-stream' }),
            arrayBuffer: async () => new ArrayBuffer(0)
        });
        const image: IPortBinaryValue = {
            kind: 'image',
            mimeType: 'image/png',
            uri: 'asset://img-003',
            referenceType: 'asset',
            assetId: 'img-003'
        };
        const result = await resolveImageInputSource(image, 'http://127.0.0.1:3011');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_IMAGE_MEDIA_TYPE_INVALID');
        }
    });

    it('returns error when asset content-type header is missing', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            body: true,
            headers: new Headers(),
            arrayBuffer: async () => new ArrayBuffer(0)
        });
        const image: IPortBinaryValue = {
            kind: 'image',
            mimeType: 'image/png',
            uri: 'asset://img-004',
            referenceType: 'asset',
            assetId: 'img-004'
        };
        const result = await resolveImageInputSource(image, 'http://127.0.0.1:3011');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_IMAGE_MEDIA_TYPE_INVALID');
        }
    });

    it('resolves http URI reference', async () => {
        const image: IPortBinaryValue = {
            kind: 'image',
            mimeType: 'image/jpeg',
            uri: 'https://cdn.example.com/photo.jpg',
            referenceType: 'uri'
        };
        const result = await resolveImageInputSource(image, 'http://127.0.0.1:3011');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.kind).toBe('uri');
            if (result.value.kind === 'uri') {
                expect(result.value.uri).toBe('https://cdn.example.com/photo.jpg');
                expect(result.value.mimeType).toBe('image/jpeg');
            }
        }
    });

    it('resolves http:// URI reference', async () => {
        const image: IPortBinaryValue = {
            kind: 'image',
            mimeType: 'image/png',
            uri: 'http://cdn.example.com/photo.png',
            referenceType: 'uri'
        };
        const result = await resolveImageInputSource(image, 'http://127.0.0.1:3011');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.kind).toBe('uri');
            if (result.value.kind === 'uri') {
                expect(result.value.uri).toBe('http://cdn.example.com/photo.png');
            }
        }
    });

    it('returns error for unsupported URI scheme', async () => {
        const image: IPortBinaryValue = {
            kind: 'image',
            mimeType: 'image/png',
            uri: 'ftp://files.example.com/photo.png',
            referenceType: 'uri'
        };
        const result = await resolveImageInputSource(image, 'http://127.0.0.1:3011');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_SEEDANCE_IMAGE_REFERENCE_UNSUPPORTED');
        }
    });

    it('returns error for empty URI', async () => {
        const image: IPortBinaryValue = {
            kind: 'image',
            mimeType: 'image/png',
            uri: '',
            referenceType: 'uri'
        };
        const result = await resolveImageInputSource(image, 'http://127.0.0.1:3011');
        expect(result.ok).toBe(false);
    });

    it('resolves asset from uri field with asset:// prefix', async () => {
        const imageBytes = new Uint8Array([255, 216, 255]); // JPEG header
        mockFetch.mockResolvedValue({
            ok: true,
            body: true,
            headers: new Headers({ 'content-type': 'image/jpeg' }),
            arrayBuffer: async () => imageBytes.buffer
        });
        // No assetId field, but uri starts with asset://
        const image: IPortBinaryValue = {
            kind: 'image',
            mimeType: 'image/jpeg',
            uri: 'asset://img-from-uri'
        };
        const result = await resolveImageInputSource(image, 'http://127.0.0.1:3011');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.kind).toBe('inline');
        }
        expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:3011/view?filename=img-from-uri');
    });
});
