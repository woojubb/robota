import { describe, expect, it } from 'vitest';
import { BundledNodeCatalogService } from '../bundled-node-catalog-service.js';
import type { INodeManifest } from '@robota-sdk/dag-core';

function createSampleManifest(nodeType: string): INodeManifest {
    return {
        nodeType,
        displayName: `${nodeType} display`,
        category: 'test',
        inputs: [],
        outputs: []
    };
}

describe('BundledNodeCatalogService', () => {
    it('returns true for registered node types', () => {
        const service = new BundledNodeCatalogService([
            createSampleManifest('image-source'),
            createSampleManifest('ok-emitter')
        ]);

        expect(service.hasNodeType('image-source')).toBe(true);
        expect(service.hasNodeType('ok-emitter')).toBe(true);
    });

    it('returns false for unregistered node types', () => {
        const service = new BundledNodeCatalogService([
            createSampleManifest('image-source')
        ]);

        expect(service.hasNodeType('unknown-type')).toBe(false);
    });

    it('returns all manifests via listManifests', async () => {
        const manifests = [
            createSampleManifest('image-source'),
            createSampleManifest('ok-emitter')
        ];
        const service = new BundledNodeCatalogService(manifests);

        const result = await service.listManifests();

        expect(result).toEqual(manifests);
        expect(result).toHaveLength(2);
    });

    it('works with an empty manifest list', async () => {
        const service = new BundledNodeCatalogService([]);

        expect(service.hasNodeType('any')).toBe(false);
        const result = await service.listManifests();
        expect(result).toEqual([]);
    });
});
