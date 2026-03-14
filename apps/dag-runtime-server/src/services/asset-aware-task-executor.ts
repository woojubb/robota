import type {
    ITaskExecutionInput,
    ITaskExecutorPort,
    IPortBinaryValue,
    TPortPayload,
    TTaskExecutionResult,
    IAssetStore,
} from '@robota-sdk/dag-core';

function isBinaryValue(value: TPortPayload[string]): value is IPortBinaryValue {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    return (
        'kind' in value
        && (value.kind === 'image' || value.kind === 'video' || value.kind === 'audio' || value.kind === 'file')
        && 'mimeType' in value
        && typeof value.mimeType === 'string'
        && 'uri' in value
        && typeof value.uri === 'string'
    );
}

function toReferenceUri(assetId: string): string {
    return `asset://${assetId}`;
}

function parseAssetIdFromUri(uri: string): string | undefined {
    if (!uri.startsWith('asset://')) {
        return undefined;
    }
    const assetId = uri.replace('asset://', '').trim();
    return assetId.length > 0 ? assetId : undefined;
}

export class AssetAwareTaskExecutorPort implements ITaskExecutorPort {
    public constructor(
        private readonly delegate: ITaskExecutorPort,
        private readonly assetStore: IAssetStore
    ) {}

    public async execute(input: ITaskExecutionInput): Promise<TTaskExecutionResult> {
        const result = await this.delegate.execute(input);
        if (!result.ok) {
            return result;
        }
        const output = await this.mapBinaryOutputsToAssetReferences(result.output);
        return {
            ok: true,
            output,
            estimatedCredits: result.estimatedCredits,
            totalCredits: result.totalCredits
        };
    }

    private async mapBinaryOutputsToAssetReferences(output: TPortPayload): Promise<TPortPayload> {
        const nextOutput: TPortPayload = {};
        for (const [key, value] of Object.entries(output)) {
            if (!isBinaryValue(value)) {
                nextOutput[key] = value;
                continue;
            }

            const existingAssetId = parseAssetIdFromUri(value.uri);
            if (existingAssetId) {
                nextOutput[key] = {
                    ...value,
                    uri: toReferenceUri(existingAssetId),
                    referenceType: 'asset',
                    assetId: existingAssetId
                };
                continue;
            }

            const metadata = await this.assetStore.saveReference({
                fileName: `${key}.${value.kind}`,
                mediaType: value.mimeType,
                sourceUri: value.uri,
                binaryKind: value.kind,
                sizeBytes: value.sizeBytes
            });
            nextOutput[key] = {
                ...value,
                uri: toReferenceUri(metadata.assetId),
                referenceType: 'asset',
                assetId: metadata.assetId
            };
        }
        return nextOutput;
    }
}
