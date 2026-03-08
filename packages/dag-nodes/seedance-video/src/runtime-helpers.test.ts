import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveRuntimeBaseUrl, toOutputVideo } from './runtime-helpers.js';

describe('resolveRuntimeBaseUrl', () => {
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        savedEnv = { ...process.env };
        delete process.env.DAG_RUNTIME_BASE_URL;
        delete process.env.DAG_DEV_PORT;
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

    it('returns http://127.0.0.1:{port} when only DAG_DEV_PORT is set', () => {
        process.env.DAG_DEV_PORT = '4000';
        expect(resolveRuntimeBaseUrl()).toBe('http://127.0.0.1:4000');
    });

    it('returns default http://127.0.0.1:3011 when no env vars are set', () => {
        expect(resolveRuntimeBaseUrl()).toBe('http://127.0.0.1:3011');
    });

    it('falls back to default port when DAG_DEV_PORT is not a valid number', () => {
        process.env.DAG_DEV_PORT = 'abc';
        expect(resolveRuntimeBaseUrl()).toBe('http://127.0.0.1:3011');
    });

    it('falls back to default port when DAG_DEV_PORT is zero', () => {
        process.env.DAG_DEV_PORT = '0';
        expect(resolveRuntimeBaseUrl()).toBe('http://127.0.0.1:3011');
    });

    it('falls back to default port when DAG_DEV_PORT is negative', () => {
        process.env.DAG_DEV_PORT = '-1';
        expect(resolveRuntimeBaseUrl()).toBe('http://127.0.0.1:3011');
    });

    it('prefers DAG_RUNTIME_BASE_URL over DAG_DEV_PORT', () => {
        process.env.DAG_RUNTIME_BASE_URL = 'https://preferred.example.com';
        process.env.DAG_DEV_PORT = '9999';
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
