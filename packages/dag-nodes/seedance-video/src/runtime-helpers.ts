import { MediaReference } from '@robota-sdk/dag-node';
import {
    buildTaskExecutionError,
    buildValidationError,
    type IDagError,
    type IPortBinaryValue,
    type TResult
} from '@robota-sdk/dag-core';
import type { IVideoJobSnapshot, TImageInputSource } from '@robota-sdk/agents';

const DEFAULT_DAG_PORT = 3011;

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
 * Converts a Seedance video job output into a standard binary port value.
 *
 * Handles both asset-based and URI-based outputs.
 *
 * @param output - The raw video job output snapshot.
 * @returns A result containing the normalized binary port value or an execution error.
 */
export function toOutputVideo(output: IVideoJobSnapshot['output']): TResult<IPortBinaryValue, IDagError> {
    if (!output) {
        return {
            ok: false,
            error: buildTaskExecutionError(
                'DAG_TASK_EXECUTION_SEEDANCE_OUTPUT_MISSING',
                'Seedance completed without output video reference',
                false
            )
        };
    }
    const mimeType = typeof output.mimeType === 'string' && output.mimeType.trim().length > 0
        ? output.mimeType
        : 'video/mp4';
    if (output.kind === 'asset') {
        if (typeof output.assetId !== 'string' || output.assetId.trim().length === 0) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_SEEDANCE_OUTPUT_ASSET_INVALID',
                    'Seedance output asset reference is missing assetId',
                    false
                )
            };
        }
        return {
            ok: true,
            value: {
                kind: 'video',
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
                'DAG_TASK_EXECUTION_SEEDANCE_OUTPUT_URI_INVALID',
                'Seedance output uri reference is missing uri',
                false
            )
        };
    }
    return {
        ok: true,
        value: {
            kind: 'video',
            mimeType,
            uri: output.uri,
            referenceType: 'uri',
            sizeBytes: output.bytes
        }
    };
}

/**
 * Resolves a binary port image into a provider-compatible image input source.
 *
 * Supports asset references (fetched via the runtime base URL) and HTTP(S) URIs.
 *
 * @param image - The binary port image value.
 * @param runtimeBaseUrl - The base URL for resolving asset content.
 * @returns A result containing the resolved image input source or a validation error.
 */
export async function resolveImageInputSource(
    image: IPortBinaryValue,
    runtimeBaseUrl: string
): Promise<TResult<TImageInputSource, IDagError>> {
    const referenceResult = MediaReference.fromBinary(image);
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
                    'Asset reference must include non-empty assetId'
                )
            };
        }
        const assetContentUrl = reference.toAssetContentUrl(runtimeBaseUrl);
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
                error: buildValidationError(
                    'DAG_VALIDATION_SEEDANCE_IMAGE_ASSET_NOT_FOUND',
                    'Seedance image asset was not found',
                    { assetId }
                )
            };
        }
        const mimeType = response.headers.get('content-type');
        if (typeof mimeType !== 'string' || !mimeType.startsWith('image/')) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_SEEDANCE_IMAGE_MEDIA_TYPE_INVALID',
                    'Seedance image asset must resolve to image media type',
                    { assetId, mimeType: mimeType ?? 'missing' }
                )
            };
        }
        const arrayBuffer = await response.arrayBuffer();
        return {
            ok: true,
            value: {
                kind: 'inline',
                mimeType,
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
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
        return {
            ok: true,
            value: {
                kind: 'uri',
                uri,
                mimeType: image.mimeType
            }
        };
    }
    return {
        ok: false,
        error: buildValidationError(
            'DAG_VALIDATION_SEEDANCE_IMAGE_REFERENCE_UNSUPPORTED',
            'Seedance image input must reference asset://, http://, or https:// URI',
            { uri }
        )
    };
}
