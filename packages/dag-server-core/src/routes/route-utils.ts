import type {
    IDagDefinition,
    TPortPayload
} from '@robota-sdk/dag-core';
import type { IAssetStore, IStoredAssetMetadata } from '../asset-store-contract.js';
import type { IAssetApiResponse, IAssetValidationError } from './route-types.js';

/** Default port for the DAG server. */
export const DEFAULT_PORT = 3011;

/** Default CORS origins allowed. */
export const DEFAULT_CORS_ORIGINS = ['http://localhost:3000'];

/** Default request body size limit. */
export const DEFAULT_REQUEST_BODY_LIMIT = '15mb';

/** Default worker timeout in milliseconds. */
export const DEFAULT_WORKER_TIMEOUT_MS = 30_000;

/** Default SSE keep-alive interval in milliseconds. */
export const DEFAULT_SSE_KEEP_ALIVE_MS = 15_000;

/** Radix for timestamp encoding in correlation IDs. */
const CORRELATION_RADIX = 36;

/** Start index for random slice in correlation IDs. */
const CORRELATION_RANDOM_SLICE_START = 2;

/** End index for random slice in correlation IDs. */
const CORRELATION_RANDOM_SLICE_END = 10;

/** parseInt radix for version parsing. */
const PARSE_INT_RADIX = 10;

/** HTTP status code for bad request. */
export const HTTP_BAD_REQUEST = 400;

/** HTTP status code for not found. */
export const HTTP_NOT_FOUND = 404;

/** HTTP status code for created. */
export const HTTP_CREATED = 201;

/** HTTP status code for accepted. */
export const HTTP_ACCEPTED = 202;

/** HTTP status code for OK. */
export const HTTP_OK = 200;

/** HTTP status code for conflict. */
export const HTTP_CONFLICT = 409;

/** HTTP status code for internal server error. */
export const HTTP_INTERNAL_SERVER_ERROR = 500;

/**
 * Creates a correlation ID with a scope prefix.
 */
export function createCorrelationId(scope: string): string {
    return `${scope}:${Date.now().toString(CORRELATION_RADIX)}:${Math.random().toString(CORRELATION_RADIX).slice(CORRELATION_RANDOM_SLICE_START, CORRELATION_RANDOM_SLICE_END)}`;
}

/**
 * Resolves a correlation ID from request header or generates a new one.
 */
export function resolveCorrelationId(req: { get(name: string): string | undefined }, scope: string): string {
    const headerValue = req.get('x-correlation-id');
    if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
        return headerValue.trim();
    }
    return createCorrelationId(scope);
}

/** Media types safe for inline display in browsers. */
const ALLOWED_INLINE_MEDIA_TYPES: ReadonlySet<string> = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'audio/webm',
    'video/mp4',
    'video/webm',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/json'
]);

/**
 * Checks whether a media type is safe for inline browser display.
 * Normalizes to lowercase and strips parameters (e.g. charset).
 */
export function isAllowedInlineMediaType(mediaType: string): boolean {
    const base = mediaType.toLowerCase().split(';')[0].trim();
    return ALLOWED_INLINE_MEDIA_TYPES.has(base);
}

/**
 * Sanitizes a file name for safe use in Content-Disposition headers.
 * Replaces `"` and `\` with `_` to prevent header injection.
 */
export function sanitizeFileName(fileName: string): string {
    return fileName.replace(/["\\]/g, '_');
}

/**
 * Converts stored asset metadata into an API response shape.
 */
export function toAssetReference(metadata: IStoredAssetMetadata, contentUri: string): IAssetApiResponse {
    return {
        referenceType: 'asset',
        assetId: metadata.assetId,
        mediaType: metadata.mediaType,
        uri: contentUri,
        name: metadata.fileName,
        sizeBytes: metadata.sizeBytes
    };
}

/**
 * Builds a content URI for an asset based on request context.
 */
export function getAssetContentUri(req: { protocol: string; get(name: string): string | undefined }, assetId: string): string {
    return `${req.protocol}://${req.get('host')}/v1/dag/assets/${assetId}/content`;
}

/**
 * Builds a version query validation error.
 */
function buildVersionQueryValidationError(): IAssetValidationError {
    return {
        code: 'DAG_VALIDATION_VERSION_QUERY_INVALID',
        detail: 'version query must be a positive integer when provided',
        retryable: false
    };
}

/**
 * Result type for version query parsing.
 */
export type TVersionQueryParseResult =
    | { ok: true; value: number | undefined }
    | { ok: false; error: IAssetValidationError };

/**
 * Parses an optional positive integer from a query string value.
 */
export function parseOptionalPositiveIntegerQuery(value: string | undefined): TVersionQueryParseResult {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return { ok: true, value: undefined };
    }
    const normalizedValue = value.trim();
    if (!/^\d+$/.test(normalizedValue)) {
        return {
            ok: false,
            error: buildVersionQueryValidationError()
        };
    }
    const parsedValue = Number.parseInt(normalizedValue, PARSE_INT_RADIX);
    if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
        return {
            ok: false,
            error: buildVersionQueryValidationError()
        };
    }
    return {
        ok: true,
        value: parsedValue
    };
}

/**
 * Parses a JSON snapshot string into a port payload object.
 */
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

/**
 * Converts a validation error into a problem details response.
 */
export function toRunProblemDetails(
    error: IAssetValidationError,
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

/**
 * Validates asset references within a DAG definition.
 */
export async function validateAssetReferences(
    definition: IDagDefinition,
    assetStore: IAssetStore
): Promise<IAssetValidationError[]> {
    const errors: IAssetValidationError[] = [];
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

        const hasAssetId = 'assetId' in assetValue && typeof assetValue.assetId === 'string' && assetValue.assetId.trim().length > 0;
        const hasUri = 'uri' in assetValue && typeof assetValue.uri === 'string' && assetValue.uri.trim().length > 0;
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
        if (referenceType === 'uri' && !hasUri) {
            errors.push({
                code: 'DAG_VALIDATION_ASSET_REFERENCE_TYPE_URI_REQUIRES_URI',
                detail: `Node ${node.nodeId} config.asset referenceType uri requires uri`,
                retryable: false
            });
            continue;
        }
        if (hasAssetId && typeof assetValue.assetId === 'string') {
            const metadata = await assetStore.getMetadata(assetValue.assetId);
            if (!metadata) {
                errors.push({
                    code: 'DAG_VALIDATION_ASSET_REFERENCE_NOT_FOUND',
                    detail: `Node ${node.nodeId} references unknown assetId: ${assetValue.assetId}`,
                    retryable: false
                });
            }
        }
    }
    return errors;
}
