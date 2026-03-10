import { describe, expect, it } from 'vitest';
import { MediaReference } from '../value-objects/media-reference.js';
import type { IPortBinaryValue } from '../interfaces/ports.js';
import type { TAssetReference } from '../types/domain.js';

describe('MediaReference', () => {
    describe('fromAssetReference', () => {
        it('creates from asset-type reference', () => {
            const ref: TAssetReference = {
                referenceType: 'asset',
                assetId: 'asset-123',
                mediaType: 'image/png',
                name: 'test.png',
                sizeBytes: 1024
            };
            const mr = MediaReference.fromAssetReference(ref);
            expect(mr.isAsset()).toBe(true);
            expect(mr.isUri()).toBe(false);
            expect(mr.assetId()).toBe('asset-123');
            expect(mr.mediaType()).toBe('image/png');
        });

        it('creates from uri-type reference', () => {
            const ref: TAssetReference = {
                referenceType: 'uri',
                uri: 'https://example.com/img.png',
                mediaType: 'image/png',
                name: 'img.png',
                sizeBytes: 2048
            };
            const mr = MediaReference.fromAssetReference(ref);
            expect(mr.isAsset()).toBe(false);
            expect(mr.isUri()).toBe(true);
            expect(mr.uri()).toBe('https://example.com/img.png');
        });
    });

    describe('fromBinary', () => {
        it('creates from binary with assetId', () => {
            const binary: IPortBinaryValue = {
                kind: 'image',
                mimeType: 'image/png',
                uri: 'asset://asset-123',
                assetId: 'asset-123',
                sizeBytes: 1024
            };
            const result = MediaReference.fromBinary(binary);
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.isAsset()).toBe(true);
            expect(result.value.assetId()).toBe('asset-123');
        });

        it('creates from binary with whitespace-only assetId falls through to URI parsing', () => {
            const binary: IPortBinaryValue = {
                kind: 'image',
                mimeType: 'image/png',
                uri: 'https://example.com/img.png',
                assetId: '   '
            };
            const result = MediaReference.fromBinary(binary);
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.isUri()).toBe(true);
        });

        it('creates from binary with asset:// URI prefix', () => {
            const binary: IPortBinaryValue = {
                kind: 'image',
                mimeType: 'image/png',
                uri: 'asset://my-asset-id'
            };
            const result = MediaReference.fromBinary(binary);
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.isAsset()).toBe(true);
            expect(result.value.assetId()).toBe('my-asset-id');
        });

        it('returns error for empty asset:// URI', () => {
            const binary: IPortBinaryValue = {
                kind: 'image',
                mimeType: 'image/png',
                uri: 'asset://   '
            };
            const result = MediaReference.fromBinary(binary);
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_MEDIA_REFERENCE_INVALID');
        });

        it('creates URI reference for non-asset:// URI', () => {
            const binary: IPortBinaryValue = {
                kind: 'image',
                mimeType: 'image/png',
                uri: 'https://example.com/img.png',
                sizeBytes: 512
            };
            const result = MediaReference.fromBinary(binary);
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.isUri()).toBe(true);
            expect(result.value.uri()).toBe('https://example.com/img.png');
        });
    });

    describe('fromCandidate', () => {
        it('creates from candidate with assetId', () => {
            const result = MediaReference.fromCandidate({
                referenceType: 'asset',
                assetId: 'asset-1',
                mediaType: 'image/png',
                name: 'test.png',
                sizeBytes: 100
            });
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.isAsset()).toBe(true);
            expect(result.value.assetId()).toBe('asset-1');
        });

        it('creates from candidate with uri', () => {
            const result = MediaReference.fromCandidate({
                referenceType: 'uri',
                uri: 'https://example.com/file.png',
                mediaType: 'image/png'
            });
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.isUri()).toBe(true);
        });

        it('returns XOR error when both assetId and uri are provided', () => {
            const result = MediaReference.fromCandidate({
                assetId: 'asset-1',
                uri: 'https://example.com'
            });
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_MEDIA_REFERENCE_XOR_REQUIRED');
        });

        it('returns XOR error when neither assetId nor uri is provided', () => {
            const result = MediaReference.fromCandidate({});
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_MEDIA_REFERENCE_XOR_REQUIRED');
        });

        it('returns type mismatch error when referenceType is asset but only uri is provided', () => {
            const result = MediaReference.fromCandidate({
                referenceType: 'asset',
                uri: 'https://example.com'
            });
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_MEDIA_REFERENCE_TYPE_MISMATCH');
        });

        it('returns type mismatch error when referenceType is uri but only assetId is provided', () => {
            const result = MediaReference.fromCandidate({
                referenceType: 'uri',
                assetId: 'asset-1'
            });
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_MEDIA_REFERENCE_TYPE_MISMATCH');
        });

        it('trims assetId whitespace', () => {
            const result = MediaReference.fromCandidate({
                assetId: '  asset-1  '
            });
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.assetId()).toBe('asset-1');
        });

        it('treats empty assetId as not provided', () => {
            const result = MediaReference.fromCandidate({
                assetId: '   ',
                uri: 'https://example.com'
            });
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.isUri()).toBe(true);
        });

        it('treats empty uri as not provided', () => {
            const result = MediaReference.fromCandidate({
                uri: '   ',
                assetId: 'asset-1'
            });
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.isAsset()).toBe(true);
        });
    });

    describe('toAssetIdOrUri', () => {
        it('returns asset variant for asset reference', () => {
            const mr = MediaReference.fromAssetReference({
                referenceType: 'asset',
                assetId: 'a1'
            });
            const result = mr.toAssetIdOrUri();
            expect(result).toEqual({ referenceType: 'asset', assetId: 'a1' });
        });

        it('returns uri variant for URI reference', () => {
            const mr = MediaReference.fromAssetReference({
                referenceType: 'uri',
                uri: 'https://example.com'
            });
            const result = mr.toAssetIdOrUri();
            expect(result).toEqual({ referenceType: 'uri', uri: 'https://example.com' });
        });
    });

    describe('toAssetContentUrl', () => {
        it('builds content URL for asset references', () => {
            const mr = MediaReference.fromAssetReference({
                referenceType: 'asset',
                assetId: 'a1'
            });
            expect(mr.toAssetContentUrl('https://api.example.com')).toBe(
                'https://api.example.com/v1/dag/assets/a1/content'
            );
        });

        it('strips trailing slash from baseUrl', () => {
            const mr = MediaReference.fromAssetReference({
                referenceType: 'asset',
                assetId: 'a1'
            });
            expect(mr.toAssetContentUrl('https://api.example.com/')).toBe(
                'https://api.example.com/v1/dag/assets/a1/content'
            );
        });

        it('returns undefined for URI references', () => {
            const mr = MediaReference.fromAssetReference({
                referenceType: 'uri',
                uri: 'https://example.com'
            });
            expect(mr.toAssetContentUrl('https://api.example.com')).toBeUndefined();
        });
    });

    describe('toBinary', () => {
        it('converts asset reference to binary value', () => {
            const mr = MediaReference.fromAssetReference({
                referenceType: 'asset',
                assetId: 'a1',
                mediaType: 'image/png',
                sizeBytes: 512
            });
            const binary = mr.toBinary('image', 'image/jpeg');
            expect(binary.kind).toBe('image');
            expect(binary.mimeType).toBe('image/png');
            expect(binary.uri).toBe('asset://a1');
            expect(binary.referenceType).toBe('asset');
            expect(binary.assetId).toBe('a1');
            expect(binary.sizeBytes).toBe(512);
        });

        it('uses default mimeType when mediaType is empty', () => {
            const mr = MediaReference.fromAssetReference({
                referenceType: 'asset',
                assetId: 'a1'
            });
            const binary = mr.toBinary('image', 'image/jpeg');
            expect(binary.mimeType).toBe('image/jpeg');
        });

        it('converts URI reference to binary value', () => {
            const mr = MediaReference.fromAssetReference({
                referenceType: 'uri',
                uri: 'https://example.com/img.png',
                mediaType: 'image/png',
                sizeBytes: 256
            });
            const binary = mr.toBinary('image', 'image/jpeg');
            expect(binary.kind).toBe('image');
            expect(binary.mimeType).toBe('image/png');
            expect(binary.uri).toBe('https://example.com/img.png');
            expect(binary.referenceType).toBe('uri');
            expect(binary.assetId).toBeUndefined();
            expect(binary.sizeBytes).toBe(256);
        });
    });
});
