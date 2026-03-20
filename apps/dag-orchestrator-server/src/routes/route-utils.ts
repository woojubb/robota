import type {
    IDagDefinition,
    TPortPayload
} from '@robota-sdk/dag-core';
import type { IAssetStore } from '@robota-sdk/dag-core';

export const HTTP_BAD_REQUEST = 400;
export const HTTP_NOT_FOUND = 404;
export const HTTP_CREATED = 201;
export const HTTP_ACCEPTED = 202;
export const HTTP_OK = 200;
export const HTTP_CONFLICT = 409;
export const HTTP_INTERNAL_SERVER_ERROR = 500;

const CORRELATION_RADIX = 36;
const CORRELATION_RANDOM_SLICE_START = 2;
const CORRELATION_RANDOM_SLICE_END = 10;
const PARSE_INT_RADIX = 10;

export function createCorrelationId(scope: string): string {
    return `${scope}:${Date.now().toString(CORRELATION_RADIX)}:${Math.random().toString(CORRELATION_RADIX).slice(CORRELATION_RANDOM_SLICE_START, CORRELATION_RANDOM_SLICE_END)}`;
}

export function resolveCorrelationId(req: { get(name: string): string | undefined }, scope: string): string {
    const headerValue = req.get('x-correlation-id');
    if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
        return headerValue.trim();
    }
    return createCorrelationId(scope);
}

const ALLOWED_INLINE_MEDIA_TYPES: ReadonlySet<string> = new Set([
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
    'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
    'video/mp4', 'video/webm',
    'application/pdf', 'text/plain', 'text/csv', 'application/json'
]);

export function isAllowedInlineMediaType(mediaType: string): boolean {
    const base = mediaType.toLowerCase().split(';')[0].trim();
    return ALLOWED_INLINE_MEDIA_TYPES.has(base);
}

export function sanitizeFileName(fileName: string): string {
    return fileName.replace(/["\\]/g, '_');
}

export function toAssetReference(
    metadata: { assetId: string; mediaType: string; fileName: string; sizeBytes: number },
    contentUri: string
): {
    referenceType: 'asset';
    assetId: string;
    mediaType: string;
    uri: string;
    name: string;
    sizeBytes: number;
} {
    return {
        referenceType: 'asset',
        assetId: metadata.assetId,
        mediaType: metadata.mediaType,
        uri: contentUri,
        name: metadata.fileName,
        sizeBytes: metadata.sizeBytes
    };
}

export function getAssetContentUri(req: { protocol: string; get(name: string): string | undefined }, assetId: string): string {
    return `${req.protocol}://${req.get('host')}/v1/dag/assets/${assetId}/content`;
}

export type TVersionQueryParseResult =
    | { ok: true; value: number | undefined }
    | { ok: false; error: { code: string; detail: string; retryable: false } };

export function parseOptionalPositiveIntegerQuery(value: string | undefined): TVersionQueryParseResult {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return { ok: true, value: undefined };
    }
    const normalizedValue = value.trim();
    if (!/^\d+$/.test(normalizedValue)) {
        return {
            ok: false,
            error: {
                code: 'DAG_VALIDATION_VERSION_QUERY_INVALID',
                detail: 'version query must be a positive integer when provided',
                retryable: false
            }
        };
    }
    const parsedValue = Number.parseInt(normalizedValue, PARSE_INT_RADIX);
    if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
        return {
            ok: false,
            error: {
                code: 'DAG_VALIDATION_VERSION_QUERY_INVALID',
                detail: 'version query must be a positive integer when provided',
                retryable: false
            }
        };
    }
    return { ok: true, value: parsedValue };
}

export function parseTaskRunPayloadSnapshot(snapshot: string | undefined): TPortPayload | undefined {
    if (typeof snapshot !== 'string' || snapshot.length === 0) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(snapshot);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return undefined;
        }
        return parsed as TPortPayload;
    } catch {
        return undefined;
    }
}

export function toRunProblemDetails(
    error: { code: string; detail: string; retryable: false },
    instance: string
): {
    type: string;
    title: string;
    status: number;
    detail: string;
    instance: string;
    code: string;
    retryable: boolean;
} {
    return {
        type: 'urn:robota:problems:dag:validation',
        title: 'DAG validation failed',
        status: HTTP_BAD_REQUEST,
        detail: error.detail,
        instance,
        code: error.code,
        retryable: error.retryable
    };
}

export async function validateAssetReferences(
    definition: IDagDefinition,
    assetStore: IAssetStore
): Promise<{ code: string; detail: string; retryable: false }[]> {
    const errors: { code: string; detail: string; retryable: false }[] = [];
    for (const node of definition.nodes) {
        const config = node.config;
        const assetValue = config.asset;
        if (typeof assetValue === 'undefined') {
            continue;
        }
        if (typeof assetValue !== 'object' || assetValue === null || Array.isArray(assetValue) || !('referenceType' in assetValue)) {
            errors.push({
                code: 'DAG_VALIDATION_ASSET_REFERENCE_OBJECT_REQUIRED',
                detail: `Node ${node.nodeId} config.asset must be a media reference object`,
                retryable: false
            });
            continue;
        }
        const referenceType = assetValue.referenceType;
        if (referenceType !== 'asset' && referenceType !== 'uri') {
            errors.push({
                code: 'DAG_VALIDATION_ASSET_REFERENCE_TYPE_INVALID',
                detail: `Node ${node.nodeId} config.asset referenceType must be asset or uri`,
                retryable: false
            });
            continue;
        }
        const hasAssetId = 'assetId' in assetValue && typeof assetValue.assetId === 'string' && (assetValue.assetId as string).trim().length > 0;
        const hasUri = 'uri' in assetValue && typeof assetValue.uri === 'string' && (assetValue.uri as string).trim().length > 0;
        if (hasAssetId === hasUri) {
            errors.push({
                code: 'DAG_VALIDATION_ASSET_REFERENCE_XOR_REQUIRED',
                detail: `Node ${node.nodeId} config.asset must provide exactly one of assetId or uri`,
                retryable: false
            });
            continue;
        }
        if (referenceType === 'asset' && !hasAssetId) {
            errors.push({
                code: 'DAG_VALIDATION_ASSET_REFERENCE_TYPE_ASSET_REQUIRES_ASSET_ID',
                detail: `Node ${node.nodeId} config.asset referenceType asset requires assetId`,
                retryable: false
            });
            continue;
        }
        if (hasAssetId && typeof assetValue.assetId === 'string') {
            const metadata = await assetStore.getMetadata(assetValue.assetId as string);
            if (!metadata) {
                errors.push({
                    code: 'DAG_VALIDATION_ASSET_REFERENCE_NOT_FOUND',
                    detail: `Node ${node.nodeId} references unknown assetId: ${assetValue.assetId as string}`,
                    retryable: false
                });
            }
        }
    }
    return errors;
}
