import type { IPortBinaryValue } from '../interfaces/ports.js';
import type { IAssetReference, TAssetReferenceType, TBinaryKind } from '../types/domain.js';
import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';
import { buildValidationError } from '../utils/error-builders.js';

const ASSET_URI_PREFIX = 'asset://';

export interface IMediaReferenceCandidate {
    referenceType?: TAssetReferenceType;
    assetId?: string;
    uri?: string;
    mediaType?: string;
    name?: string;
    sizeBytes?: number;
}

interface INormalizedMediaReference {
    referenceType: TAssetReferenceType;
    assetId?: string;
    uri?: string;
    mediaType?: string;
    name?: string;
    sizeBytes?: number;
}

export class MediaReference {
    private constructor(private readonly value: INormalizedMediaReference) {}

    public static fromAssetReference(reference: IAssetReference): MediaReference {
        if (reference.referenceType === 'asset') {
            return new MediaReference({
                referenceType: 'asset',
                assetId: reference.assetId,
                mediaType: reference.mediaType,
                name: reference.name,
                sizeBytes: reference.sizeBytes
            });
        }
        return new MediaReference({
            referenceType: 'uri',
            uri: reference.uri,
            mediaType: reference.mediaType,
            name: reference.name,
            sizeBytes: reference.sizeBytes
        });
    }

    public static fromBinary(value: IPortBinaryValue): TResult<MediaReference, IDagError> {
        if (typeof value.assetId === 'string' && value.assetId.trim().length > 0) {
            return {
                ok: true,
                value: new MediaReference({
                    referenceType: 'asset',
                    assetId: value.assetId.trim(),
                    mediaType: value.mimeType,
                    sizeBytes: value.sizeBytes
                })
            };
        }
        if (value.uri.startsWith(ASSET_URI_PREFIX)) {
            const parsedAssetId = value.uri.slice(ASSET_URI_PREFIX.length).trim();
            if (parsedAssetId.length === 0) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_MEDIA_REFERENCE_INVALID',
                        'Binary asset URI must include non-empty assetId'
                    )
                };
            }
            return {
                ok: true,
                value: new MediaReference({
                    referenceType: 'asset',
                    assetId: parsedAssetId,
                    mediaType: value.mimeType,
                    sizeBytes: value.sizeBytes
                })
            };
        }
        return {
            ok: true,
            value: new MediaReference({
                referenceType: 'uri',
                uri: value.uri,
                mediaType: value.mimeType,
                sizeBytes: value.sizeBytes
            })
        };
    }

    public static fromCandidate(
        candidate: IMediaReferenceCandidate,
        options?: { allowEmptyUri?: boolean; allowEmptyAssetId?: boolean }
    ): TResult<MediaReference, IDagError> {
        const hasAssetId = typeof candidate.assetId === 'string'
            && (options?.allowEmptyAssetId === true || candidate.assetId.trim().length > 0);
        const hasUri = typeof candidate.uri === 'string'
            && (options?.allowEmptyUri === true || candidate.uri.trim().length > 0);

        if (hasAssetId === hasUri) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_MEDIA_REFERENCE_XOR_REQUIRED',
                    'Exactly one of assetId or uri must be provided'
                )
            };
        }

        if (candidate.referenceType === 'asset' && !hasAssetId) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_MEDIA_REFERENCE_TYPE_MISMATCH',
                    'referenceType asset requires assetId'
                )
            };
        }
        if (candidate.referenceType === 'uri' && !hasUri) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_MEDIA_REFERENCE_TYPE_MISMATCH',
                    'referenceType uri requires uri'
                )
            };
        }

        if (hasAssetId && typeof candidate.assetId === 'string') {
            return {
                ok: true,
                value: new MediaReference({
                    referenceType: 'asset',
                    assetId: candidate.assetId.trim(),
                    mediaType: candidate.mediaType,
                    name: candidate.name,
                    sizeBytes: candidate.sizeBytes
                })
            };
        }

        if (typeof candidate.uri !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_MEDIA_REFERENCE_INVALID',
                    'uri must be a string when referenceType is uri'
                )
            };
        }

        return {
            ok: true,
            value: new MediaReference({
                referenceType: 'uri',
                uri: candidate.uri,
                mediaType: candidate.mediaType,
                name: candidate.name,
                sizeBytes: candidate.sizeBytes
            })
        };
    }

    public isAsset(): boolean {
        return this.value.referenceType === 'asset';
    }

    public isUri(): boolean {
        return this.value.referenceType === 'uri';
    }

    public assetId(): string | undefined {
        return this.value.assetId;
    }

    public uri(): string | undefined {
        return this.value.uri;
    }

    public mediaType(): string | undefined {
        return this.value.mediaType;
    }

    public toAssetIdOrUri():
    | { referenceType: 'asset'; assetId: string }
    | { referenceType: 'uri'; uri: string } {
        if (this.value.referenceType === 'asset' && typeof this.value.assetId === 'string') {
            return {
                referenceType: 'asset',
                assetId: this.value.assetId
            };
        }
        return {
            referenceType: 'uri',
            uri: this.value.uri ?? ''
        };
    }

    public toAssetContentUrl(baseUrl: string): string | undefined {
        if (!this.isAsset() || typeof this.value.assetId !== 'string') {
            return undefined;
        }
        return `${baseUrl.replace(/\/$/, '')}/v1/dag/assets/${this.value.assetId}/content`;
    }

    public toBinary(kind: TBinaryKind, defaultMimeType: string): IPortBinaryValue {
        const mimeType = typeof this.value.mediaType === 'string' && this.value.mediaType.trim().length > 0
            ? this.value.mediaType
            : defaultMimeType;
        if (this.value.referenceType === 'asset' && typeof this.value.assetId === 'string') {
            return {
                kind,
                mimeType,
                uri: `${ASSET_URI_PREFIX}${this.value.assetId}`,
                referenceType: 'asset',
                assetId: this.value.assetId,
                sizeBytes: this.value.sizeBytes
            };
        }
        return {
            kind,
            mimeType,
            uri: this.value.uri ?? '',
            referenceType: 'uri',
            sizeBytes: this.value.sizeBytes
        };
    }
}

