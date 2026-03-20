/**
 * Asset store contract for DAG infrastructure.
 * Implementations (e.g. LocalFsAssetStore) are provided by the runtime adapter.
 *
 * Uses Uint8Array and ReadableStream to remain runtime-agnostic.
 * Node.js callers can pass Buffer (extends Uint8Array) directly.
 */

export interface IStoredAssetMetadata {
    assetId: string;
    fileName: string;
    mediaType: string;
    sizeBytes: number;
    createdAt: string;
    sourceUri?: string;
    binaryKind?: 'image' | 'video' | 'audio' | 'file';
}

export interface ICreateAssetInput {
    fileName: string;
    mediaType: string;
    content: Uint8Array;
}

export interface ICreateAssetReferenceInput {
    fileName: string;
    mediaType: string;
    sourceUri: string;
    binaryKind: 'image' | 'video' | 'audio' | 'file';
    sizeBytes?: number;
}

export interface IAssetContentResult {
    stream: AsyncIterable<Uint8Array>;
    metadata: IStoredAssetMetadata;
}

/**
 * Contract for asset storage.
 * Implementations are provided by the app (e.g. LocalFsAssetStore).
 */
export interface IAssetStore {
    save(input: ICreateAssetInput): Promise<IStoredAssetMetadata>;

    saveReference(input: ICreateAssetReferenceInput): Promise<IStoredAssetMetadata>;

    getMetadata(assetId: string): Promise<IStoredAssetMetadata | undefined>;

    getContent(
        assetId: string
    ): Promise<IAssetContentResult | undefined>;

    initialize?(): Promise<void>;
}
