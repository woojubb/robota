import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IPortBinaryValue } from '@robota-sdk/dag-core';
import { toInlineImageSource } from './runtime-helpers.js';

// Mock global fetch for HTTP and asset resolution tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeImageBinary(overrides?: Partial<IPortBinaryValue>): IPortBinaryValue {
    return {
        kind: 'image',
        mimeType: 'image/png',
        uri: 'data:image/png;base64,iVBOR',
        ...overrides
    };
}

const DEFAULT_OPTIONS = {
    runtimeBaseUrl: 'http://127.0.0.1:3011',
    notFoundCode: 'DAG_VALIDATION_GEMINI_IMAGE_INPUT_ASSET_NOT_FOUND',
    notFoundMessage: 'Input image asset was not found or is not binary content'
};

describe('toInlineImageSource', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // -----------------------------------------------------------------------
    // Data URI resolution
    // -----------------------------------------------------------------------
    describe('data URI input', () => {
        it('resolves valid data URI to inline image source', async () => {
            const result = await toInlineImageSource({
                image: makeImageBinary({ uri: 'data:image/png;base64,iVBOR' }),
                ...DEFAULT_OPTIONS
            });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toEqual({
                    kind: 'inline',
                    mimeType: 'image/png',
                    data: 'iVBOR'
                });
            }
        });

        it('returns error for malformed data URI without comma', async () => {
            const result = await toInlineImageSource({
                image: makeImageBinary({ uri: 'data:image/png;base64' }),
                ...DEFAULT_OPTIONS
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_INPUT_DATA_URI_INVALID');
            }
        });

        it('returns error for data URI without base64 encoding', async () => {
            const result = await toInlineImageSource({
                image: makeImageBinary({ uri: 'data:image/png,rawdata' }),
                ...DEFAULT_OPTIONS
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_INPUT_DATA_URI_INVALID');
            }
        });

        it('returns error for data URI with empty payload', async () => {
            const result = await toInlineImageSource({
                image: makeImageBinary({ uri: 'data:image/png;base64,' }),
                ...DEFAULT_OPTIONS
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_INPUT_DATA_URI_INVALID');
            }
        });

        it('returns error for data URI with empty mime type', async () => {
            const result = await toInlineImageSource({
                image: makeImageBinary({ uri: 'data:;base64,iVBOR' }),
                ...DEFAULT_OPTIONS
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_INPUT_DATA_URI_INVALID');
            }
        });
    });

    // -----------------------------------------------------------------------
    // HTTP URI resolution
    // -----------------------------------------------------------------------
    describe('HTTP URI input', () => {
        it('resolves valid HTTP URI to inline image source', async () => {
            const imageBuffer = new ArrayBuffer(4);
            mockFetch.mockResolvedValue({
                ok: true,
                body: true,
                headers: new Headers({ 'content-type': 'image/jpeg' }),
                arrayBuffer: () => Promise.resolve(imageBuffer)
            });

            const result = await toInlineImageSource({
                image: makeImageBinary({ uri: 'https://example.com/photo.jpg' }),
                ...DEFAULT_OPTIONS
            });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.kind).toBe('inline');
                expect(result.value.mimeType).toBe('image/jpeg');
            }
        });

        it('resolves valid HTTP URI (http scheme) to inline image source', async () => {
            const imageBuffer = new ArrayBuffer(4);
            mockFetch.mockResolvedValue({
                ok: true,
                body: true,
                headers: new Headers({ 'content-type': 'image/png' }),
                arrayBuffer: () => Promise.resolve(imageBuffer)
            });

            const result = await toInlineImageSource({
                image: makeImageBinary({ uri: 'http://example.com/photo.png' }),
                ...DEFAULT_OPTIONS
            });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.kind).toBe('inline');
                expect(result.value.mimeType).toBe('image/png');
            }
        });

        it('returns error when HTTP fetch fails', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                body: null
            });

            const result = await toInlineImageSource({
                image: makeImageBinary({ uri: 'https://example.com/missing.jpg' }),
                ...DEFAULT_OPTIONS
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_INPUT_URI_UNREACHABLE');
            }
        });

        it('returns error when HTTP response has non-image content type', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                body: true,
                headers: new Headers({ 'content-type': 'application/json' }),
                arrayBuffer: () => Promise.resolve(new ArrayBuffer(4))
            });

            const result = await toInlineImageSource({
                image: makeImageBinary({ uri: 'https://example.com/data.json' }),
                ...DEFAULT_OPTIONS
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_INPUT_MEDIA_TYPE_INVALID');
            }
        });

        it('returns error when HTTP response has no content type', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                body: true,
                headers: new Headers(),
                arrayBuffer: () => Promise.resolve(new ArrayBuffer(4))
            });

            const result = await toInlineImageSource({
                image: makeImageBinary({ uri: 'https://example.com/unknown' }),
                ...DEFAULT_OPTIONS
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_INPUT_MEDIA_TYPE_INVALID');
            }
        });

        it('returns error when HTTP response body is null', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                body: null
            });

            const result = await toInlineImageSource({
                image: makeImageBinary({ uri: 'https://example.com/empty' }),
                ...DEFAULT_OPTIONS
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_INPUT_URI_UNREACHABLE');
            }
        });
    });

    // -----------------------------------------------------------------------
    // Asset URI resolution
    // -----------------------------------------------------------------------
    describe('asset URI input', () => {
        it('resolves valid asset URI to inline image source', async () => {
            const imageBuffer = new ArrayBuffer(8);
            mockFetch.mockResolvedValue({
                ok: true,
                body: true,
                headers: new Headers({ 'content-type': 'image/png' }),
                arrayBuffer: () => Promise.resolve(imageBuffer)
            });

            const result = await toInlineImageSource({
                image: makeImageBinary({
                    uri: 'asset://my-asset-id',
                    referenceType: 'asset',
                    assetId: 'my-asset-id'
                }),
                ...DEFAULT_OPTIONS
            });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.kind).toBe('inline');
                expect(result.value.mimeType).toBe('image/png');
            }
        });

        it('returns error when asset fetch returns non-ok response', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                body: null
            });

            const result = await toInlineImageSource({
                image: makeImageBinary({
                    uri: 'asset://missing-asset',
                    referenceType: 'asset',
                    assetId: 'missing-asset'
                }),
                ...DEFAULT_OPTIONS
            });
            expect(result.ok).toBe(false);
        });

        it('returns error when asset response has non-image content type', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                body: true,
                headers: new Headers({ 'content-type': 'text/plain' }),
                arrayBuffer: () => Promise.resolve(new ArrayBuffer(4))
            });

            const result = await toInlineImageSource({
                image: makeImageBinary({
                    uri: 'asset://text-asset',
                    referenceType: 'asset',
                    assetId: 'text-asset'
                }),
                ...DEFAULT_OPTIONS
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_INPUT_MEDIA_TYPE_INVALID');
            }
        });
    });

    // -----------------------------------------------------------------------
    // Unsupported URI schemes
    // -----------------------------------------------------------------------
    describe('unsupported URI schemes', () => {
        it('returns error for ftp URI', async () => {
            const result = await toInlineImageSource({
                image: makeImageBinary({ uri: 'ftp://example.com/image.png' }),
                ...DEFAULT_OPTIONS
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_INPUT_REFERENCE_UNSUPPORTED');
            }
        });

        it('returns error for unknown scheme', async () => {
            const result = await toInlineImageSource({
                image: makeImageBinary({ uri: 'custom://something' }),
                ...DEFAULT_OPTIONS
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('DAG_VALIDATION_GEMINI_IMAGE_INPUT_REFERENCE_UNSUPPORTED');
            }
        });
    });

    // -----------------------------------------------------------------------
    // Empty URI edge case
    // -----------------------------------------------------------------------
    describe('empty URI', () => {
        it('returns error when URI is empty string', async () => {
            const result = await toInlineImageSource({
                image: makeImageBinary({ uri: '' }),
                ...DEFAULT_OPTIONS
            });
            expect(result.ok).toBe(false);
        });
    });
});
