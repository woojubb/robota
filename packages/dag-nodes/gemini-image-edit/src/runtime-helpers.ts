import {
    MediaReference,
    buildTaskExecutionError,
    buildValidationError,
    type IDagError,
    type IPortBinaryValue,
    type TResult
} from '@robota-sdk/dag-core';
import type { IMediaOutputRef } from '@robota-sdk/agents';

const DATA_URI_PREFIX_MAX_LENGTH = 64;

const DEFAULT_DAG_DEV_PORT = 3011;

/** Represents a base64-encoded inline image ready to send to the Gemini API. */
export interface IInlineImageSource {
    kind: 'inline';
    mimeType: string;
    data: string;
}

/** Options for converting a binary port image into an inline image source. */
export interface IInlineImageSourceOptions {
    image: IPortBinaryValue;
    runtimeBaseUrl: string;
    notFoundCode: string;
    notFoundMessage: string;
}

/**
 * Parses a comma-separated string into a trimmed, non-empty array of values.
 *
 * @param value - The raw CSV string, or `undefined`.
 * @returns An array of trimmed non-empty tokens.
 */
export function parseCsv(value: string | undefined): string[] {
    if (typeof value !== 'string') {
        return [];
    }
    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

/**
 * Resolves the DAG runtime base URL from environment variables.
 *
 * Falls back to `http://127.0.0.1:<port>` using `DAG_DEV_PORT` or the default port 3011.
 */
export function resolveRuntimeBaseUrl(): string {
    const runtimeBaseUrl = process.env.DAG_RUNTIME_BASE_URL?.trim();
    if (runtimeBaseUrl && runtimeBaseUrl.length > 0) {
        return runtimeBaseUrl.replace(/\/$/, '');
    }
    const portRaw = process.env.DAG_DEV_PORT;
    const portParsed = typeof portRaw === 'string' ? Number.parseInt(portRaw, 10) : Number.NaN;
    const port = Number.isFinite(portParsed) && portParsed > 0 ? portParsed : DEFAULT_DAG_DEV_PORT;
    return `http://127.0.0.1:${port}`;
}

/**
 * Resolves and validates a model identifier against the allowed model list.
 *
 * @param selectedModel - The model requested by config.
 * @param defaultModel - The fallback model when the selection is empty.
 * @param allowedModels - The set of permitted model identifiers.
 * @returns A result containing the resolved model name or a validation error.
 */
export function resolveModel(
    selectedModel: string,
    defaultModel: string,
    allowedModels: string[]
): TResult<string, IDagError> {
    const model = selectedModel.trim().length > 0 ? selectedModel.trim() : defaultModel;
    if (allowedModels.length > 0 && !allowedModels.includes(model)) {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_GEMINI_IMAGE_MODEL_NOT_ALLOWED',
                'Selected Gemini image model is not allowed in DAG runtime',
                { model }
            )
        };
    }
    return {
        ok: true,
        value: model
    };
}

function parseDataUri(uri: string): { mimeType: string; data: string } | undefined {
    const commaIndex = uri.indexOf(',');
    if (commaIndex < 0) {
        return undefined;
    }
    const header = uri.slice(0, commaIndex);
    const payload = uri.slice(commaIndex + 1);
    if (!header.startsWith('data:') || !header.endsWith(';base64')) {
        return undefined;
    }
    const mimeType = header.replace('data:', '').replace(';base64', '').trim();
    if (mimeType.length === 0 || payload.trim().length === 0) {
        return undefined;
    }
    return {
        mimeType,
        data: payload
    };
}

/**
 * Converts a binary port image value into an inline base64-encoded image source.
 *
 * Supports asset references, data URIs, and HTTP(S) URIs.
 *
 * @param options - The image, runtime base URL, and error metadata.
 * @returns A result containing the inline image source or a validation error.
 */
export async function toInlineImageSource(
    options: IInlineImageSourceOptions
): Promise<TResult<IInlineImageSource, IDagError>> {
    const referenceResult = MediaReference.fromBinary(options.image);
    if (!referenceResult.ok) {
        return referenceResult;
    }
    const reference = referenceResult.value;

    if (reference.isAsset()) {
        const assetId = reference.assetId();
        if (typeof assetId !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_MEDIA_REFERENCE_INVALID',
                    'Asset reference must include a valid assetId'
                )
            };
        }
        const assetContentUrl = reference.toAssetContentUrl(options.runtimeBaseUrl);
        if (typeof assetContentUrl !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_MEDIA_REFERENCE_INVALID',
                    'Asset content URL could not be resolved',
                    { assetId }
                )
            };
        }
        const response = await fetch(assetContentUrl);
        if (!response.ok || !response.body) {
            return {
                ok: false,
                error: buildValidationError(options.notFoundCode, options.notFoundMessage, { assetId })
            };
        }
        const mediaType = response.headers.get('content-type');
        if (typeof mediaType !== 'string' || !mediaType.startsWith('image/')) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_INPUT_MEDIA_TYPE_INVALID',
                    'Gemini image input asset must resolve to image media type',
                    { assetId, mediaType: mediaType ?? 'missing' }
                )
            };
        }
        const arrayBuffer = await response.arrayBuffer();
        return {
            ok: true,
            value: {
                kind: 'inline',
                mimeType: mediaType,
                data: Buffer.from(arrayBuffer).toString('base64')
            }
        };
    }

    const uri = reference.uri();
    if (typeof uri !== 'string' || uri.length === 0) {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_MEDIA_REFERENCE_INVALID',
                'URI reference must include non-empty uri'
            )
        };
    }

    if (uri.startsWith('data:')) {
        const parsedDataUri = parseDataUri(uri);
        if (!parsedDataUri) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_INPUT_DATA_URI_INVALID',
                    'Gemini image input data URI must be base64 encoded',
                    { uriPrefix: uri.slice(0, DATA_URI_PREFIX_MAX_LENGTH) }
                )
            };
        }
        return {
            ok: true,
            value: {
                kind: 'inline',
                mimeType: parsedDataUri.mimeType,
                data: parsedDataUri.data
            }
        };
    }
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
        const response = await fetch(uri);
        if (!response.ok || !response.body) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_INPUT_URI_UNREACHABLE',
                    'Gemini image input URI must be reachable',
                    { uri }
                )
            };
        }
        const mediaType = response.headers.get('content-type');
        if (typeof mediaType !== 'string' || !mediaType.startsWith('image/')) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_INPUT_MEDIA_TYPE_INVALID',
                    'Gemini image input URI must resolve to image media type',
                    { uri, mediaType: mediaType ?? 'missing' }
                )
            };
        }
        const arrayBuffer = await response.arrayBuffer();
        return {
            ok: true,
            value: {
                kind: 'inline',
                mimeType: mediaType,
                data: Buffer.from(arrayBuffer).toString('base64')
            }
        };
    }
    return {
        ok: false,
        error: buildValidationError(
            'DAG_VALIDATION_GEMINI_IMAGE_INPUT_REFERENCE_UNSUPPORTED',
            'Gemini image input must be asset://, data:, http://, or https:// URI',
            { uri }
        )
    };
}

/**
 * Normalizes a provider media output reference into a standard binary port value.
 *
 * Handles both asset-based and URI-based outputs, including data URIs.
 *
 * @param output - The raw media output reference from the provider.
 * @returns A result containing the normalized binary port value or an execution error.
 */
export function normalizeImageOutput(output: IMediaOutputRef): TResult<IPortBinaryValue, IDagError> {
    if (output.kind === 'asset') {
        if (typeof output.assetId !== 'string' || output.assetId.trim().length === 0) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_ASSET_INVALID',
                    'Provider returned asset output without valid assetId',
                    false
                )
            };
        }
        const mimeType = typeof output.mimeType === 'string' && output.mimeType.trim().length > 0
            ? output.mimeType
            : '';
        if (!mimeType.startsWith('image/')) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_MEDIA_TYPE_INVALID',
                    'Provider returned non-image media type for Gemini output',
                    false,
                    { mimeType }
                )
            };
        }
        return {
            ok: true,
            value: {
                kind: 'image',
                mimeType,
                uri: `asset://${output.assetId}`,
                referenceType: 'asset',
                assetId: output.assetId,
                sizeBytes: output.bytes
            }
        };
    }
    if (typeof output.uri !== 'string' || output.uri.trim().length === 0) {
        return {
            ok: false,
            error: buildTaskExecutionError(
                'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_URI_MISSING',
                'Provider returned uri output without uri value',
                false
            )
        };
    }
    const outputMimeType = typeof output.mimeType === 'string' && output.mimeType.trim().length > 0
        ? output.mimeType
        : '';
    if (output.uri.startsWith('data:')) {
        const parsedDataUri = parseDataUri(output.uri);
        if (!parsedDataUri || !parsedDataUri.mimeType.startsWith('image/')) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_URI_UNSUPPORTED',
                    'Provider URI output must be image data URI',
                    false
                )
            };
        }
        return {
            ok: true,
            value: {
                kind: 'image',
                mimeType: parsedDataUri.mimeType,
                uri: output.uri,
                referenceType: 'uri'
            }
        };
    }
    if (!outputMimeType.startsWith('image/')) {
        return {
            ok: false,
            error: buildTaskExecutionError(
                'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_MEDIA_TYPE_INVALID',
                'Provider returned non-image URI output for Gemini runtime',
                false,
                { mimeType: outputMimeType }
            )
        };
    }
    return {
        ok: true,
        value: {
            kind: 'image',
            mimeType: outputMimeType,
            uri: output.uri,
            referenceType: 'uri',
            sizeBytes: output.bytes
        }
    };
}
