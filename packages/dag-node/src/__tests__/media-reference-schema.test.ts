import { describe, expect, it } from 'vitest';
import { MediaReferenceSchema, createMediaReferenceConfigSchema } from '../schemas/media-reference-schema.js';

describe('MediaReferenceSchema', () => {
    it('parses valid asset reference', () => {
        const result = MediaReferenceSchema.safeParse({
            referenceType: 'asset',
            assetId: 'asset-123',
            mediaType: 'image/png',
            name: 'test.png',
            sizeBytes: 1024
        });
        expect(result.success).toBe(true);
    });

    it('parses valid URI reference', () => {
        const result = MediaReferenceSchema.safeParse({
            referenceType: 'uri',
            uri: 'https://example.com/file.png',
            mediaType: 'image/png'
        });
        expect(result.success).toBe(true);
    });

    it('rejects empty assetId', () => {
        const result = MediaReferenceSchema.safeParse({
            referenceType: 'asset',
            assetId: ''
        });
        expect(result.success).toBe(false);
    });

    it('rejects empty uri', () => {
        const result = MediaReferenceSchema.safeParse({
            referenceType: 'uri',
            uri: ''
        });
        expect(result.success).toBe(false);
    });

    it('rejects invalid referenceType', () => {
        const result = MediaReferenceSchema.safeParse({
            referenceType: 'invalid',
            assetId: 'a1'
        });
        expect(result.success).toBe(false);
    });
});

describe('createMediaReferenceConfigSchema', () => {
    it('creates schema with asset key', () => {
        const schema = createMediaReferenceConfigSchema();
        const result = schema.safeParse({
            asset: {
                referenceType: 'uri',
                uri: 'https://example.com/file.png'
            }
        });
        expect(result.success).toBe(true);
    });

    it('rejects missing asset key', () => {
        const schema = createMediaReferenceConfigSchema();
        const result = schema.safeParse({});
        expect(result.success).toBe(false);
    });
});
