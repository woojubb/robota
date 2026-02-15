import type { INodeManifest } from '../types/domain.js';
import type { INodeManifestRegistry } from '../types/node-lifecycle.js';

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
