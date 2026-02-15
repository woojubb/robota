import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
    createDefaultNodeManifestRegistry,
    type IDagError,
    type INodeManifest,
    type TResult,
    buildValidationError
} from '@robota-sdk/dag-core';
import type { INodeCatalogService } from '@robota-sdk/dag-api';

interface INodeFolderMetadata {
    hidden?: boolean;
    enabled?: boolean;
    category?: string;
}

interface INodeCollectionMetadata {
    nodes?: Record<string, INodeFolderMetadata>;
}

interface ILoadedNode {
    manifest: INodeManifest;
}

function resolveNodeStoreDir(): string {
    const configured = process.env.ROBOTA_NODE_STORE_DIR;
    if (typeof configured === 'string' && configured.trim().length > 0) {
        return configured;
    }

    const direct = path.resolve(process.cwd(), '.robota/nodes');
    if (existsSync(direct)) {
        return direct;
    }

    const monorepoRootCandidate = path.resolve(process.cwd(), '../../.robota/nodes');
    if (existsSync(monorepoRootCandidate)) {
        return monorepoRootCandidate;
    }

    return direct;
}

function isNodeManifest(value: unknown): value is INodeManifest {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return typeof record.nodeType === 'string'
        && typeof record.displayName === 'string'
        && typeof record.category === 'string'
        && Array.isArray(record.inputs)
        && Array.isArray(record.outputs);
}

async function readCollectionMetadata(storeDir: string): Promise<INodeCollectionMetadata> {
    const metadataPath = path.join(storeDir, 'collection.json');
    try {
        const raw = await readFile(metadataPath, 'utf-8');
        const parsed = JSON.parse(raw) as INodeCollectionMetadata;
        return parsed;
    } catch {
        return {};
    }
}

async function scanNodeFolders(storeDir: string): Promise<ILoadedNode[]> {
    const loadedNodes: ILoadedNode[] = [];
    let publisherEntries;
    try {
        publisherEntries = await readdir(storeDir, { withFileTypes: true });
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return loadedNodes;
        }
        throw error;
    }
    for (const publisherEntry of publisherEntries) {
        if (!publisherEntry.isDirectory()) {
            continue;
        }
        const publisherDir = path.join(storeDir, publisherEntry.name);
        const nodeTypeEntries = await readdir(publisherDir, { withFileTypes: true });
        for (const nodeTypeEntry of nodeTypeEntries) {
            if (!nodeTypeEntry.isDirectory()) {
                continue;
            }
            const nodeTypeDir = path.join(publisherDir, nodeTypeEntry.name);
            const versionEntries = await readdir(nodeTypeDir, { withFileTypes: true });
            for (const versionEntry of versionEntries) {
                if (!versionEntry.isDirectory()) {
                    continue;
                }
                const versionDir = path.join(nodeTypeDir, versionEntry.name);
                const manifestPath = path.join(versionDir, 'manifest.json');
                const rawManifest = await readFile(manifestPath, 'utf-8');
                const parsedManifest = JSON.parse(rawManifest);
                if (!isNodeManifest(parsedManifest)) {
                    throw new Error(`Invalid manifest schema at ${manifestPath}`);
                }
                loadedNodes.push({
                    manifest: parsedManifest
                });
            }
        }
    }
    return loadedNodes;
}

export class LocalNodeCatalogService implements INodeCatalogService {
    private manifests: INodeManifest[];

    public constructor(
        private readonly storeDir: string = resolveNodeStoreDir(),
        private readonly baseManifests: INodeManifest[] = createDefaultNodeManifestRegistry().listManifests()
    ) {
        this.manifests = [...baseManifests];
    }

    public hasNodeType(nodeType: string): boolean {
        return this.manifests.some((manifest) => manifest.nodeType === nodeType);
    }

    public async listManifests(): Promise<INodeManifest[]> {
        return this.manifests;
    }

    public async reload(): Promise<TResult<{ loadedCount: number }, IDagError>> {
        try {
            const collectionMetadata = await readCollectionMetadata(this.storeDir);
            const loadedNodes = await scanNodeFolders(this.storeDir);
            const metadataByNodeType = collectionMetadata.nodes ?? {};

            const localManifests = loadedNodes
                .map((loaded) => {
                    const metadata = metadataByNodeType[loaded.manifest.nodeType];
                    if (metadata?.enabled === false || metadata?.hidden === true) {
                        return undefined;
                    }
                    if (metadata?.category) {
                        return {
                            ...loaded.manifest,
                            category: metadata.category
                        };
                    }
                    return loaded.manifest;
                })
                .filter((manifest): manifest is INodeManifest => manifest !== undefined);

            const manifestByNodeType = new Map<string, INodeManifest>();
            for (const baseManifest of this.baseManifests) {
                manifestByNodeType.set(baseManifest.nodeType, baseManifest);
            }
            for (const localManifest of localManifests) {
                manifestByNodeType.set(localManifest.nodeType, localManifest);
            }

            this.manifests = [...manifestByNodeType.values()].sort((a, b) =>
                a.category.localeCompare(b.category) || a.displayName.localeCompare(b.displayName)
            );

            return {
                ok: true,
                value: { loadedCount: localManifests.length }
            };
        } catch (error) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_NODE_CATALOG_RELOAD_FAILED',
                    'Node catalog reload failed',
                    {
                        storeDir: this.storeDir,
                        reason: error instanceof Error ? error.message : 'unknown'
                    }
                )
            };
        }
    }
}
