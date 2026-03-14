import { describe, expect, it } from 'vitest';
import {
    buildListPortHandleKey,
    parseListPortHandleKey
} from '../types/domain.js';
import { createBinaryPortDefinition, BINARY_PORT_PRESETS } from '@robota-sdk/dag-node';
import { buildNodeDefinitionAssembly } from '../types/node-lifecycle.js';
import { z } from 'zod';
import type { INodeTaskHandler } from '../types/node-lifecycle.js';

describe('buildListPortHandleKey', () => {
    it('builds handle key for index 0', () => {
        expect(buildListPortHandleKey('images', 0)).toBe('images[0]');
    });

    it('builds handle key for index 5', () => {
        expect(buildListPortHandleKey('items', 5)).toBe('items[5]');
    });
});

describe('parseListPortHandleKey', () => {
    it('parses valid handle key', () => {
        const result = parseListPortHandleKey('images[0]');
        expect(result).toEqual({ portKey: 'images', index: 0 });
    });

    it('parses handle key with larger index', () => {
        const result = parseListPortHandleKey('items[42]');
        expect(result).toEqual({ portKey: 'items', index: 42 });
    });

    it('returns undefined for key without brackets', () => {
        expect(parseListPortHandleKey('images')).toBeUndefined();
    });

    it('returns undefined for key with no opening bracket', () => {
        expect(parseListPortHandleKey('images0]')).toBeUndefined();
    });

    it('returns undefined for key with non-numeric index', () => {
        expect(parseListPortHandleKey('images[abc]')).toBeUndefined();
    });

    it('returns undefined when bracket is at position 0', () => {
        expect(parseListPortHandleKey('[0]')).toBeUndefined();
    });
});

describe('createBinaryPortDefinition', () => {
    it('creates binary port from IMAGE_PNG preset', () => {
        const port = createBinaryPortDefinition({
            key: 'image',
            label: 'Image',
            order: 0,
            required: true,
            preset: BINARY_PORT_PRESETS.IMAGE_PNG
        });
        expect(port.type).toBe('binary');
        expect(port.binaryKind).toBe('image');
        expect(port.mimeTypes).toEqual(['image/png']);
        expect(port.key).toBe('image');
        expect(port.required).toBe(true);
    });

    it('creates list binary port with constraints', () => {
        const port = createBinaryPortDefinition({
            key: 'images',
            required: true,
            preset: BINARY_PORT_PRESETS.IMAGE_COMMON,
            isList: true,
            minItems: 1,
            maxItems: 5
        });
        expect(port.isList).toBe(true);
        expect(port.minItems).toBe(1);
        expect(port.maxItems).toBe(5);
        expect(port.mimeTypes).toEqual(['image/png', 'image/jpeg', 'image/webp']);
    });
});

describe('BINARY_PORT_PRESETS', () => {
    it('has IMAGE_PNG preset', () => {
        expect(BINARY_PORT_PRESETS.IMAGE_PNG.binaryKind).toBe('image');
    });

    it('has VIDEO_MP4 preset', () => {
        expect(BINARY_PORT_PRESETS.VIDEO_MP4.binaryKind).toBe('video');
    });

    it('has AUDIO_MPEG preset', () => {
        expect(BINARY_PORT_PRESETS.AUDIO_MPEG.binaryKind).toBe('audio');
    });

    it('has FILE_GENERIC preset', () => {
        expect(BINARY_PORT_PRESETS.FILE_GENERIC.binaryKind).toBe('file');
        expect(BINARY_PORT_PRESETS.FILE_GENERIC.mimeTypes).toHaveLength(0);
    });
});

describe('buildNodeDefinitionAssembly', () => {
    it('builds assembly from valid node definitions', () => {
        const handler: INodeTaskHandler = {
            execute: async () => ({ ok: true, value: {} })
        };
        const result = buildNodeDefinitionAssembly([
            {
                nodeType: 'test-node',
                displayName: 'Test',
                category: 'test',
                inputs: [],
                outputs: [],
                configSchemaDefinition: z.object({ prompt: z.string() }),
                taskHandler: handler
            }
        ]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.manifests).toHaveLength(1);
        expect(result.value.manifests[0].nodeType).toBe('test-node');
        expect(result.value.handlersByType['test-node']).toBe(handler);
    });

    it('returns error for invalid config schema', () => {
        const handler: INodeTaskHandler = {
            execute: async () => ({ ok: true, value: {} })
        };
        const result = buildNodeDefinitionAssembly([
            {
                nodeType: 'bad-node',
                displayName: 'Bad',
                category: 'test',
                inputs: [],
                outputs: [],
                configSchemaDefinition: 'not-a-zod-schema',
                taskHandler: handler
            }
        ]);
        expect(result.ok).toBe(false);
    });
});
