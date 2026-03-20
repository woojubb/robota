import { buildValidationError } from '@robota-sdk/dag-core';
import type { IDagError } from '@robota-sdk/dag-core';
import type { TResult } from '@robota-sdk/dag-core';
import type { TPortValue } from '@robota-sdk/dag-core';

/** Validated binary port value with kind, MIME type, and URI. */
export interface IParsedBinaryValue {
    kind: 'image' | 'video' | 'audio' | 'file';
    mimeType: string;
    uri: string;
    referenceType?: 'asset' | 'uri';
    assetId?: string;
    sizeBytes?: number;
}

/**
 * Parses and validates a raw port value as a binary payload object.
 *
 * @param rawValue - The raw port value to parse.
 * @param nodeId - The node identifier (for error context).
 * @param key - The port key name (for error context).
 * @param kind - Optional expected binary kind constraint.
 * @returns A validated binary value or a validation error.
 */
export function parseBinaryValue(
    rawValue: TPortValue,
    nodeId: string,
    key: string,
    kind?: 'image' | 'video' | 'audio' | 'file'
): TResult<IParsedBinaryValue, IDagError> {
    if (typeof rawValue !== 'object' || rawValue === null || Array.isArray(rawValue)) {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH',
                'Node input key must be binary payload object',
                { nodeId, key, expectedType: 'binary' }
            )
        };
    }
    const value = rawValue as {
        kind?: unknown;
        mimeType?: unknown;
        uri?: unknown;
        referenceType?: unknown;
        assetId?: unknown;
        sizeBytes?: unknown;
    };
    const validKind = value.kind === 'image' || value.kind === 'video' || value.kind === 'audio' || value.kind === 'file';
    if (!validKind || typeof value.mimeType !== 'string' || typeof value.uri !== 'string') {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH',
                'Node input key must be valid binary payload',
                { nodeId, key, expectedType: 'binary' }
            )
        };
    }
    const binaryKind = value.kind as 'image' | 'video' | 'audio' | 'file';
    if (kind && binaryKind !== kind) {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH',
                'Node input binary kind does not match expected kind',
                { nodeId, key, expectedKind: kind, actualKind: binaryKind }
            )
        };
    }
    return {
        ok: true,
        value: {
            kind: binaryKind,
            mimeType: value.mimeType,
            uri: value.uri,
            referenceType: value.referenceType === 'asset' || value.referenceType === 'uri' ? value.referenceType : undefined,
            assetId: typeof value.assetId === 'string' ? value.assetId : undefined,
            sizeBytes: typeof value.sizeBytes === 'number' ? value.sizeBytes : undefined
        }
    };
}
