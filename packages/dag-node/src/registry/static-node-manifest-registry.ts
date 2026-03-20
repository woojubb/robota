import type { INodeManifest } from '@robota-sdk/dag-core';
import type { INodeManifestRegistry } from '@robota-sdk/dag-core';

/** In-memory registry of node manifests, queryable by node type. */
export class StaticNodeManifestRegistry implements INodeManifestRegistry {
    private readonly manifestByType = new Map<string, INodeManifest>();

    public constructor(manifests: INodeManifest[]) {
        for (const manifest of manifests) {
            this.manifestByType.set(manifest.nodeType, manifest);
        }
    }

    public getManifest(nodeType: string): INodeManifest | undefined {
        return this.manifestByType.get(nodeType);
    }

    public listManifests(): INodeManifest[] {
        return [...this.manifestByType.values()];
    }
}
