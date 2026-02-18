import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
    IAssetStore,
    IStoredAssetMetadata,
    ICreateAssetInput,
    ICreateAssetReferenceInput,
    IAssetContentResult
} from '@robota-sdk/dag-server-core';

export type { IStoredAssetMetadata } from '@robota-sdk/dag-server-core';

export class LocalFsAssetStore implements IAssetStore {
    private readonly rootDir: string;

    public constructor(rootDir: string) {
        this.rootDir = rootDir;
    }

    public async initialize(): Promise<void> {
        if (!existsSync(this.rootDir)) {
            await mkdir(this.rootDir, { recursive: true });
        }
    }

    public async save(input: ICreateAssetInput): Promise<IStoredAssetMetadata> {
        const assetId = randomUUID();
        const filePath = this.buildBinaryPath(assetId);
        const metadataPath = this.buildMetadataPath(assetId);
        const now = new Date().toISOString();
        await writeFile(filePath, input.content);
        const metadata: IStoredAssetMetadata = {
            assetId,
            fileName: input.fileName,
            mediaType: input.mediaType,
            sizeBytes: input.content.byteLength,
            createdAt: now
        };
        await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
        return metadata;
    }

    public async saveReference(input: ICreateAssetReferenceInput): Promise<IStoredAssetMetadata> {
        const assetId = randomUUID();
        const metadataPath = this.buildMetadataPath(assetId);
        const now = new Date().toISOString();
        const metadata: IStoredAssetMetadata = {
            assetId,
            fileName: input.fileName,
            mediaType: input.mediaType,
            sizeBytes: input.sizeBytes ?? 0,
            createdAt: now,
            sourceUri: input.sourceUri,
            binaryKind: input.binaryKind
        };
        await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
        return metadata;
    }

    public async getMetadata(assetId: string): Promise<IStoredAssetMetadata | undefined> {
        const metadataPath = this.buildMetadataPath(assetId);
        if (!existsSync(metadataPath)) {
            return undefined;
        }
        const metadataText = await readFile(metadataPath, 'utf-8');
        return JSON.parse(metadataText) as IStoredAssetMetadata;
    }

    public async getContent(assetId: string): Promise<IAssetContentResult | undefined> {
        const metadata = await this.getMetadata(assetId);
        if (!metadata) {
            return undefined;
        }
        if (typeof metadata.sourceUri === 'string' && metadata.sourceUri.trim().length > 0) {
            return undefined;
        }
        const binaryPath = this.buildBinaryPath(assetId);
        if (!existsSync(binaryPath)) {
            return undefined;
        }
        const fileInfo = await stat(binaryPath);
        if (!fileInfo.isFile()) {
            return undefined;
        }
        return {
            stream: createReadStream(binaryPath),
            metadata
        };
    }

    private buildBinaryPath(assetId: string): string {
        return path.join(this.rootDir, `${assetId}.bin`);
    }

    private buildMetadataPath(assetId: string): string {
        return path.join(this.rootDir, `${assetId}.json`);
    }
}
