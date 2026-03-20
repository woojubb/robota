import { describe, expect, it } from 'vitest';
import { buildNodeDefinitionAssembly } from '../node-definition-assembly.js';
import { createBinaryPortDefinition, BINARY_PORT_PRESETS } from '../port-definition-helpers.js';
import { z } from 'zod';
import type { INodeTaskHandler } from '@robota-sdk/dag-core';

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
