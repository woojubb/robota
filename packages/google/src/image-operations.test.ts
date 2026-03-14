import { describe, expect, it } from 'vitest';
import type { TUniversalMessage, TUniversalMessagePart } from '@robota-sdk/agents';
import {
    hasImagePart,
    mapInlineImagePartsToMediaOutputs,
    parseDataUri,
    mapImageInputSourceToPart,
    buildResponseModalities,
    isImageCapableModel,
    buildGenerationConfig
} from './image-operations';

describe('hasImagePart', () => {
    it('returns false for undefined parts', () => {
        expect(hasImagePart(undefined)).toBe(false);
    });

    it('returns false for empty parts array', () => {
        expect(hasImagePart([])).toBe(false);
    });

    it('returns false when only text parts exist', () => {
        const parts: TUniversalMessagePart[] = [{ type: 'text', text: 'hello' }];
        expect(hasImagePart(parts)).toBe(false);
    });

    it('returns true when image_inline part exists', () => {
        const parts: TUniversalMessagePart[] = [
            { type: 'image_inline', mimeType: 'image/png', data: 'abc' }
        ];
        expect(hasImagePart(parts)).toBe(true);
    });

    it('returns true when image_uri part exists', () => {
        const parts: TUniversalMessagePart[] = [
            { type: 'image_uri', uri: 'https://example.com/img.png', mimeType: 'image/png' }
        ];
        expect(hasImagePart(parts)).toBe(true);
    });

    it('returns true when mixed parts include an image', () => {
        const parts: TUniversalMessagePart[] = [
            { type: 'text', text: 'describe this' },
            { type: 'image_inline', mimeType: 'image/jpeg', data: 'data' }
        ];
        expect(hasImagePart(parts)).toBe(true);
    });
});

describe('mapInlineImagePartsToMediaOutputs', () => {
    it('returns empty array for undefined parts', () => {
        expect(mapInlineImagePartsToMediaOutputs(undefined)).toEqual([]);
    });

    it('returns empty array when no image parts exist', () => {
        const parts: TUniversalMessagePart[] = [{ type: 'text', text: 'hello' }];
        expect(mapInlineImagePartsToMediaOutputs(parts)).toEqual([]);
    });

    it('converts inline image parts to media output references', () => {
        const parts: TUniversalMessagePart[] = [
            { type: 'image_inline', mimeType: 'image/png', data: 'abc123' }
        ];
        const result = mapInlineImagePartsToMediaOutputs(parts);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            kind: 'uri',
            uri: 'data:image/png;base64,abc123',
            mimeType: 'image/png'
        });
    });

    it('skips non-inline-image parts', () => {
        const parts: TUniversalMessagePart[] = [
            { type: 'text', text: 'hello' },
            { type: 'image_inline', mimeType: 'image/png', data: 'data1' },
            { type: 'image_uri', uri: 'https://example.com/img.png', mimeType: 'image/png' },
            { type: 'image_inline', mimeType: 'image/jpeg', data: 'data2' }
        ];
        const result = mapInlineImagePartsToMediaOutputs(parts);
        expect(result).toHaveLength(2);
        expect(result[0]?.mimeType).toBe('image/png');
        expect(result[1]?.mimeType).toBe('image/jpeg');
    });
});

describe('parseDataUri', () => {
    it('parses a valid data URI', () => {
        const result = parseDataUri('data:image/png;base64,abc123');
        expect(result).toEqual({ mimeType: 'image/png', data: 'abc123' });
    });

    it('returns undefined for URI without comma', () => {
        expect(parseDataUri('data:image/png;base64')).toBeUndefined();
    });

    it('returns undefined for URI without base64 encoding marker', () => {
        expect(parseDataUri('data:image/png,abc123')).toBeUndefined();
    });

    it('returns undefined for empty MIME type', () => {
        expect(parseDataUri('data:;base64,abc123')).toBeUndefined();
    });

    it('returns undefined for empty payload', () => {
        expect(parseDataUri('data:image/png;base64,')).toBeUndefined();
    });

    it('returns undefined for whitespace-only payload', () => {
        expect(parseDataUri('data:image/png;base64,   ')).toBeUndefined();
    });

    it('parses data URI with complex MIME type', () => {
        const result = parseDataUri('data:application/octet-stream;base64,AQID');
        expect(result).toEqual({ mimeType: 'application/octet-stream', data: 'AQID' });
    });
});

describe('mapImageInputSourceToPart', () => {
    it('maps inline source with valid data', () => {
        const result = mapImageInputSourceToPart({
            kind: 'inline',
            mimeType: 'image/png',
            data: 'base64data'
        });
        expect(result).toEqual({
            ok: true,
            value: { type: 'image_inline', mimeType: 'image/png', data: 'base64data' }
        });
    });

    it('rejects inline source with empty mimeType', () => {
        const result = mapImageInputSourceToPart({
            kind: 'inline',
            mimeType: '',
            data: 'base64data'
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
            expect(result.error.message).toContain('non-empty mimeType and data');
        }
    });

    it('rejects inline source with empty data', () => {
        const result = mapImageInputSourceToPart({
            kind: 'inline',
            mimeType: 'image/png',
            data: ''
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
        }
    });

    it('rejects inline source with whitespace-only mimeType', () => {
        const result = mapImageInputSourceToPart({
            kind: 'inline',
            mimeType: '   ',
            data: 'base64data'
        });
        expect(result.ok).toBe(false);
    });

    it('maps URI source with valid data URI', () => {
        const result = mapImageInputSourceToPart({
            kind: 'uri',
            uri: 'data:image/jpeg;base64,imgdata'
        });
        expect(result).toEqual({
            ok: true,
            value: { type: 'image_inline', mimeType: 'image/jpeg', data: 'imgdata' }
        });
    });

    it('rejects non-data URI sources', () => {
        const result = mapImageInputSourceToPart({
            kind: 'uri',
            uri: 'https://example.com/img.png'
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
            expect(result.error.message).toContain('only inline or data URI');
        }
    });

    it('rejects invalid data URI format', () => {
        const result = mapImageInputSourceToPart({
            kind: 'uri',
            uri: 'data:image/png,not-base64'
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('PROVIDER_INVALID_REQUEST');
            expect(result.error.message).toContain('base64 payload');
        }
    });

    it('rejects data URI with empty payload', () => {
        const result = mapImageInputSourceToPart({
            kind: 'uri',
            uri: 'data:image/png;base64,'
        });
        expect(result.ok).toBe(false);
    });
});

describe('buildResponseModalities', () => {
    const textMessage: TUniversalMessage = {
        role: 'user',
        content: 'hello',
        timestamp: new Date()
    };
    const imageMessage: TUniversalMessage = {
        role: 'user',
        content: '',
        parts: [{ type: 'image_inline', mimeType: 'image/png', data: 'data' }],
        timestamp: new Date()
    };

    it('returns option modalities when explicitly provided', () => {
        const result = buildResponseModalities([textMessage], undefined, ['IMAGE']);
        expect(result).toEqual(['IMAGE']);
    });

    it('returns ["TEXT", "IMAGE"] when input has image parts and no explicit option', () => {
        const result = buildResponseModalities([imageMessage], undefined, undefined);
        expect(result).toEqual(['TEXT', 'IMAGE']);
    });

    it('returns default modalities when no image input and no option', () => {
        const result = buildResponseModalities([textMessage], ['TEXT', 'IMAGE'], undefined);
        expect(result).toEqual(['TEXT', 'IMAGE']);
    });

    it('returns ["TEXT"] when no image input, no defaults, and no option', () => {
        const result = buildResponseModalities([textMessage], undefined, undefined);
        expect(result).toEqual(['TEXT']);
    });

    it('option modalities take precedence over image input detection', () => {
        const result = buildResponseModalities([imageMessage], undefined, ['TEXT']);
        expect(result).toEqual(['TEXT']);
    });

    it('option modalities take precedence over default modalities', () => {
        const result = buildResponseModalities([textMessage], ['IMAGE'], ['TEXT']);
        expect(result).toEqual(['TEXT']);
    });

    it('returns ["TEXT"] for empty option modalities array (falls through)', () => {
        const result = buildResponseModalities([textMessage], undefined, []);
        expect(result).toEqual(['TEXT']);
    });

    it('returns default modalities even with empty option modalities', () => {
        const result = buildResponseModalities([textMessage], ['IMAGE'], []);
        expect(result).toEqual(['IMAGE']);
    });
});

describe('isImageCapableModel', () => {
    it('returns true when model is in configured allowlist', () => {
        expect(isImageCapableModel('my-custom-model', ['my-custom-model'])).toBe(true);
    });

    it('returns false when model is not in configured allowlist', () => {
        expect(isImageCapableModel('gemini-pro', ['my-custom-model'])).toBe(false);
    });

    it('allows any model when no allowlist provided', () => {
        expect(isImageCapableModel('gemini-2.5-flash-image', undefined)).toBe(true);
        expect(isImageCapableModel('gemini-pro', undefined)).toBe(true);
    });

    it('allows any model when allowlist is empty', () => {
        expect(isImageCapableModel('some-image-model', [])).toBe(true);
        expect(isImageCapableModel('gemini-pro', [])).toBe(true);
    });
});

describe('buildGenerationConfig', () => {
    const textMessage: TUniversalMessage = {
        role: 'user',
        content: 'hello',
        timestamp: new Date()
    };

    it('returns TEXT modality for basic text request', () => {
        const result = buildGenerationConfig([textMessage], undefined, undefined, {
            model: 'gemini-pro'
        });
        expect(result.responseModalities).toEqual(['TEXT']);
    });

    it('includes temperature and maxOutputTokens from options', () => {
        const result = buildGenerationConfig([textMessage], undefined, undefined, {
            model: 'gemini-pro',
            temperature: 0.5,
            maxTokens: 1000
        });
        expect(result.temperature).toBe(0.5);
        expect(result.maxOutputTokens).toBe(1000);
    });

    it('allows IMAGE modality with any model when no allowlist configured', () => {
        const result = buildGenerationConfig([textMessage], undefined, undefined, {
            model: 'gemini-pro',
            google: { responseModalities: ['IMAGE'] }
        });
        expect(result.responseModalities).toEqual(['IMAGE']);
    });

    it('does not throw when IMAGE modality with an image-capable model', () => {
        const result = buildGenerationConfig([textMessage], undefined, undefined, {
            model: 'gemini-2.5-flash-image',
            google: { responseModalities: ['TEXT', 'IMAGE'] }
        });
        expect(result.responseModalities).toEqual(['TEXT', 'IMAGE']);
    });

    it('uses custom imageCapableModels allowlist', () => {
        const result = buildGenerationConfig([textMessage], undefined, ['custom-model'], {
            model: 'custom-model',
            google: { responseModalities: ['IMAGE'] }
        });
        expect(result.responseModalities).toEqual(['IMAGE']);
    });

    it('throws for non-allowlisted model when allowlist is provided', () => {
        expect(() =>
            buildGenerationConfig([textMessage], undefined, ['custom-model'], {
                model: 'other-model',
                google: { responseModalities: ['IMAGE'] }
            })
        ).toThrow('Selected model "other-model" is not configured as image-capable');
    });

    it('handles undefined options gracefully', () => {
        const result = buildGenerationConfig([textMessage], undefined, undefined);
        expect(result.responseModalities).toEqual(['TEXT']);
        expect(result.temperature).toBeUndefined();
        expect(result.maxOutputTokens).toBeUndefined();
    });

    it('auto-detects IMAGE modality from image input', () => {
        const imageMessage: TUniversalMessage = {
            role: 'user',
            content: '',
            parts: [{ type: 'image_inline', mimeType: 'image/png', data: 'data' }],
            timestamp: new Date()
        };
        const result = buildGenerationConfig([imageMessage], undefined, undefined, {
            model: 'gemini-2.5-flash-image'
        });
        expect(result.responseModalities).toEqual(['TEXT', 'IMAGE']);
    });

    it('respects default modalities', () => {
        const result = buildGenerationConfig([textMessage], ['TEXT', 'IMAGE'], ['gemini-pro'], {
            model: 'gemini-pro'
        });
        expect(result.responseModalities).toEqual(['TEXT', 'IMAGE']);
    });
});
