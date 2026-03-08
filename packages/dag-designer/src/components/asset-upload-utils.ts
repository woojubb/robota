import type { INodeConfigObject } from '@robota-sdk/dag-core';

export interface IAssetUploadResponse {
    ok?: boolean;
    data?: {
        asset?: {
            assetId?: string;
        };
    };
}

export interface IAssetConfigValue {
    referenceType: 'asset' | 'uri';
    assetId?: string;
    uri?: string;
    mediaType?: string;
    name?: string;
    sizeBytes?: number;
}

export function parseAssetConfigValue(value: unknown): IAssetConfigValue | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }
    const candidate = value as Record<string, unknown>;
    if (candidate.referenceType !== 'asset' && candidate.referenceType !== 'uri') {
        return undefined;
    }
    return {
        referenceType: candidate.referenceType,
        assetId: typeof candidate.assetId === 'string' ? candidate.assetId : undefined,
        uri: typeof candidate.uri === 'string' ? candidate.uri : undefined,
        mediaType: typeof candidate.mediaType === 'string' ? candidate.mediaType : undefined,
        name: typeof candidate.name === 'string' ? candidate.name : undefined,
        sizeBytes: typeof candidate.sizeBytes === 'number' ? candidate.sizeBytes : undefined
    };
}

export function buildAssetConfigValue(value: IAssetConfigValue): INodeConfigObject {
    const nextValue: INodeConfigObject = {
        referenceType: value.referenceType
    };
    if (value.referenceType === 'asset') {
        if (typeof value.assetId === 'string' && value.assetId.trim().length > 0) {
            nextValue.assetId = value.assetId.trim();
        }
    } else if (typeof value.uri === 'string' && value.uri.trim().length > 0) {
        nextValue.uri = value.uri.trim();
    }
    if (typeof value.mediaType === 'string' && value.mediaType.trim().length > 0) {
        nextValue.mediaType = value.mediaType.trim();
    }
    if (typeof value.name === 'string' && value.name.trim().length > 0) {
        nextValue.name = value.name.trim();
    }
    if (typeof value.sizeBytes === 'number' && Number.isFinite(value.sizeBytes) && value.sizeBytes >= 0) {
        nextValue.sizeBytes = Math.trunc(value.sizeBytes);
    }
    return nextValue;
}

export function toBase64(file: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result !== 'string') {
                reject(new Error('Failed to read file'));
                return;
            }
            const delimiterIndex = reader.result.indexOf(',');
            if (delimiterIndex < 0) {
                reject(new Error('Invalid data URL format'));
                return;
            }
            resolve(reader.result.slice(delimiterIndex + 1));
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}
