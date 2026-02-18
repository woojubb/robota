/**
 * Asset store contract for DAG server.
 * Implementations (e.g. LocalFsAssetStore) are provided by the runtime adapter.
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
    content: Buffer;
}

export interface ICreateAssetReferenceInput {
    fileName: string;
    mediaType: string;
    sourceUri: string;
    binaryKind: 'image' | 'video' | 'audio' | 'file';
    sizeBytes?: number;
}

export interface IAssetContentResult {
    stream: NodeJS.ReadableStream;
    metadata: IStoredAssetMetadata;
}

/**
 * Contract for asset storage used by DAG server bootstrap.
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
