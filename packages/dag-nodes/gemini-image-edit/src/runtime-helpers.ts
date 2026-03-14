import { MediaReference } from '@robota-sdk/dag-node';
import {
    buildValidationError,
    type IDagError,
    type IPortBinaryValue,
    type TResult
} from '@robota-sdk/dag-core';

export { normalizeImageOutput } from './image-output-normalizer.js';

const DATA_URI_PREFIX_MAX_LENGTH = 64;

const DEFAULT_DAG_PORT = 3011;

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
 * Falls back to `http://127.0.0.1:<port>` using `DAG_PORT` or the default port 3011.
 */
export function resolveRuntimeBaseUrl(): string {
    const runtimeBaseUrl = process.env.DAG_RUNTIME_BASE_URL?.trim();
    if (runtimeBaseUrl && runtimeBaseUrl.length > 0) {
        return runtimeBaseUrl.replace(/\/$/, '');
    }
    const portRaw = process.env.DAG_PORT;
    const portParsed = typeof portRaw === 'string' ? Number.parseInt(portRaw, 10) : Number.NaN;
    const port = Number.isFinite(portParsed) && portParsed > 0 ? portParsed : DEFAULT_DAG_PORT;
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
    return { ok: true, value: model };
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
    return { mimeType, data: payload };
}

/**
 * Converts a binary port image value into an inline base64-encoded image source.
 *
 * Supports asset references, data URIs, and HTTP(S) URIs.
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
        return fetchAssetInlineImage(reference, options);
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
        return parseDataUriInlineImage(uri);
    }
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
        return fetchHttpInlineImage(uri);
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

async function fetchAssetInlineImage(
    reference: MediaReference,
    options: IInlineImageSourceOptions
): Promise<TResult<IInlineImageSource, IDagError>> {
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
        value: { kind: 'inline', mimeType: mediaType, data: Buffer.from(arrayBuffer).toString('base64') }
    };
}

function parseDataUriInlineImage(uri: string): TResult<IInlineImageSource, IDagError> {
    const parsedResult = parseDataUri(uri);
    if (!parsedResult) {
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
        value: { kind: 'inline', mimeType: parsedResult.mimeType, data: parsedResult.data }
    };
}

async function fetchHttpInlineImage(uri: string): Promise<TResult<IInlineImageSource, IDagError>> {
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
        value: { kind: 'inline', mimeType: mediaType, data: Buffer.from(arrayBuffer).toString('base64') }
    };
}
