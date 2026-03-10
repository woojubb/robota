import { describe, expect, it } from 'vitest';
import { StaticNodeManifestRegistry } from '../registry/static-node-manifest-registry.js';
import type { INodeManifest } from '../types/domain.js';

const manifest1: INodeManifest = {
    nodeType: 'type-a',
    displayName: 'Type A',
    category: 'test',
    inputs: [],
    outputs: []
};

const manifest2: INodeManifest = {
    nodeType: 'type-b',
    displayName: 'Type B',
    category: 'test',
    inputs: [{ key: 'in', type: 'string', required: true }],
    outputs: [{ key: 'out', type: 'string', required: true }]
};

describe('StaticNodeManifestRegistry', () => {
    it('returns manifest for registered type', () => {
        const registry = new StaticNodeManifestRegistry([manifest1, manifest2]);
        expect(registry.getManifest('type-a')).toBe(manifest1);
        expect(registry.getManifest('type-b')).toBe(manifest2);
    });

    it('returns undefined for unregistered type', () => {
        const registry = new StaticNodeManifestRegistry([manifest1]);
        expect(registry.getManifest('unknown')).toBeUndefined();
    });

    it('lists all manifests', () => {
        const registry = new StaticNodeManifestRegistry([manifest1, manifest2]);
        const list = registry.listManifests();
        expect(list).toHaveLength(2);
        expect(list).toContain(manifest1);
        expect(list).toContain(manifest2);
    });

    it('returns empty list for empty registry', () => {
        const registry = new StaticNodeManifestRegistry([]);
        expect(registry.listManifests()).toHaveLength(0);
    });
});
