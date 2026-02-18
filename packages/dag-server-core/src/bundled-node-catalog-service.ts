import type { INodeManifest } from '@robota-sdk/dag-core';
import type { INodeCatalogService } from '@robota-sdk/dag-api';

export class BundledNodeCatalogService implements INodeCatalogService {
    private readonly manifestByNodeType = new Map<string, INodeManifest>();

    public constructor(private readonly manifests: INodeManifest[]) {
        for (const manifest of manifests) {
            this.manifestByNodeType.set(manifest.nodeType, manifest);
        }
    }

    public hasNodeType(nodeType: string): boolean {
        return this.manifestByNodeType.has(nodeType);
    }

    public async listManifests(): Promise<INodeManifest[]> {
        return this.manifests;
    }
}
