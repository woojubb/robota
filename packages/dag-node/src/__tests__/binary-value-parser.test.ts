import { describe, expect, it } from 'vitest';
import { parseBinaryValue } from '../lifecycle/binary-value-parser.js';

describe('parseBinaryValue', () => {
    const validBinary = {
        kind: 'image' as const,
        mimeType: 'image/png',
        uri: 'https://example.com/img.png'
    };

    it('parses a valid binary value', () => {
        const result = parseBinaryValue(validBinary, 'node-1', 'image');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.kind).toBe('image');
        expect(result.value.mimeType).toBe('image/png');
        expect(result.value.uri).toBe('https://example.com/img.png');
    });

    it('returns error for non-object value (string)', () => {
        const result = parseBinaryValue('not-binary', 'node-1', 'image');
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH');
    });

    it('returns error for null value', () => {
        const result = parseBinaryValue(null, 'node-1', 'image');
        expect(result.ok).toBe(false);
    });

    it('returns error for array value', () => {
        const result = parseBinaryValue([], 'node-1', 'image');
        expect(result.ok).toBe(false);
    });

    it('returns error when missing required fields (no mimeType)', () => {
        const result = parseBinaryValue(
            { kind: 'image', uri: 'some-uri' } as any,
            'node-1',
            'image'
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH');
    });

    it('returns error when kind is invalid', () => {
        const result = parseBinaryValue(
            { kind: 'pdf', mimeType: 'application/pdf', uri: 'some-uri' } as any,
            'node-1',
            'image'
        );
        expect(result.ok).toBe(false);
    });

    it('returns error when kind does not match expected kind', () => {
        const result = parseBinaryValue(validBinary, 'node-1', 'image', 'video');
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH');
        expect(result.error.context?.expectedKind).toBe('video');
        expect(result.error.context?.actualKind).toBe('image');
    });

    it('passes when kind matches expected kind', () => {
        const result = parseBinaryValue(validBinary, 'node-1', 'image', 'image');
        expect(result.ok).toBe(true);
    });

    it('parses optional referenceType, assetId, and sizeBytes', () => {
        const binaryWithExtras = {
            ...validBinary,
            referenceType: 'asset' as const,
            assetId: 'asset-123',
            sizeBytes: 1024
        };
        const result = parseBinaryValue(binaryWithExtras, 'node-1', 'image');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.referenceType).toBe('asset');
        expect(result.value.assetId).toBe('asset-123');
        expect(result.value.sizeBytes).toBe(1024);
    });

    it('ignores invalid referenceType values', () => {
        const binary = { ...validBinary, referenceType: 'invalid' };
        const result = parseBinaryValue(binary as any, 'node-1', 'image');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.referenceType).toBeUndefined();
    });

    it('ignores non-string assetId', () => {
        const binary = { ...validBinary, assetId: 123 };
        const result = parseBinaryValue(binary as any, 'node-1', 'image');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.assetId).toBeUndefined();
    });

    it('ignores non-number sizeBytes', () => {
        const binary = { ...validBinary, sizeBytes: 'big' };
        const result = parseBinaryValue(binary as any, 'node-1', 'image');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.sizeBytes).toBeUndefined();
    });
});
