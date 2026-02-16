import {
    BINARY_PORT_PRESETS,
    buildValidationError,
    createBinaryPortDefinition,
    type IAssetReference,
    type ICostEstimate,
    type IDagNodeDefinition,
    type INodeExecutionContext,
    type IDagError,
    type TResult,
    type TPortPayload
} from '@robota-sdk/dag-core';
import { z } from 'zod';

function isAssetReference(value: unknown): value is IAssetReference {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    if (!('referenceType' in value) || (value.referenceType !== 'asset' && value.referenceType !== 'uri')) {
        return false;
    }
    if (value.referenceType === 'asset') {
        return 'assetId' in value && typeof value.assetId === 'string' && value.assetId.trim().length > 0;
    }
    return 'uri' in value && typeof value.uri === 'string' && value.uri.trim().length > 0;
}

class ImageSourceNodeTaskHandler {
    public async estimateCost(): Promise<TResult<ICostEstimate, IDagError>> {
        return { ok: true, value: { estimatedCostUsd: 0 } };
    }

    public async execute(_input: TPortPayload, context: INodeExecutionContext): Promise<TResult<TPortPayload, IDagError>> {
        const assetReferenceValue = context.nodeDefinition.config.asset;
        if (isAssetReference(assetReferenceValue)) {
            const mediaType = typeof assetReferenceValue.mediaType === 'string' && assetReferenceValue.mediaType.trim().length > 0
                ? assetReferenceValue.mediaType
                : 'image/png';
            if (assetReferenceValue.referenceType === 'asset') {
                return {
                    ok: true,
                    value: {
                        image: {
                            kind: 'image',
                            mimeType: mediaType,
                            uri: `asset://${assetReferenceValue.assetId}`,
                            referenceType: 'asset',
                            assetId: assetReferenceValue.assetId
                        }
                    }
                };
            }
            return {
                ok: true,
                value: {
                    image: {
                        kind: 'image',
                        mimeType: mediaType,
                        uri: assetReferenceValue.uri,
                        referenceType: 'uri'
                    }
                }
            };
        }

        const referenceTypeValue = context.nodeDefinition.config.referenceType;
        const assetIdValue = context.nodeDefinition.config.assetId;
        if (
            referenceTypeValue === 'asset'
            && typeof assetIdValue === 'string'
            && assetIdValue.trim().length > 0
        ) {
            const mediaType = typeof context.nodeDefinition.config.mimeType === 'string'
                ? context.nodeDefinition.config.mimeType
                : 'image/png';
            return {
                ok: true,
                value: {
                    image: {
                        kind: 'image',
                        mimeType: mediaType,
                        uri: `asset://${assetIdValue}`,
                        referenceType: 'asset',
                        assetId: assetIdValue
                    }
                }
            };
        }

        const uriValue = context.nodeDefinition.config.uri;
        if (typeof uriValue !== 'string' || uriValue.trim().length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_IMAGE_SOURCE_URI_REQUIRED',
                    'Image source node requires config.asset.assetId or a non-empty config.uri',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }

        const mimeTypeValue = context.nodeDefinition.config.mimeType;
        const mimeType = typeof mimeTypeValue === 'string' && mimeTypeValue.trim().length > 0
            ? mimeTypeValue
            : 'image/png';

        return {
            ok: true,
            value: {
                image: {
                    kind: 'image',
                    mimeType,
                    uri: uriValue,
                    referenceType: 'uri'
                }
            }
        };
    }
}

export class ImageSourceNodeDefinition implements IDagNodeDefinition {
    public readonly nodeType = 'image-source';
    public readonly displayName = 'Image Source';
    public readonly category = 'Test';
    public readonly inputs = [];
    public readonly outputs = [
        createBinaryPortDefinition({
            key: 'image',
            label: 'Image',
            order: 0,
            required: true,
            description: 'Test image output',
            preset: BINARY_PORT_PRESETS.IMAGE_PNG
        })
    ];
    public readonly configSchemaDefinition = z.object({
        asset: z.union([
            z.object({
                referenceType: z.literal('asset'),
                assetId: z.string().min(1),
                mediaType: z.string().optional(),
                name: z.string().optional(),
                sizeBytes: z.number().nonnegative().optional()
            }),
            z.object({
                referenceType: z.literal('uri'),
                uri: z.string().min(1),
                mediaType: z.string().optional(),
                name: z.string().optional(),
                sizeBytes: z.number().nonnegative().optional()
            })
        ]).optional(),
        referenceType: z.enum(['asset', 'uri']).optional(),
        assetId: z.string().min(1).optional(),
        uri: z.string().min(1).optional(),
        mimeType: z.string().optional()
    }).superRefine((config, ctx) => {
        if (typeof config.asset !== 'undefined') {
            return;
        }
        const hasAssetId = typeof config.assetId === 'string' && config.assetId.trim().length > 0;
        const hasUri = typeof config.uri === 'string' && config.uri.trim().length > 0;
        if (hasAssetId === hasUri) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Exactly one of assetId or uri must be provided.'
            });
            return;
        }
        if (config.referenceType === 'asset' && !hasAssetId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'referenceType asset requires assetId.'
            });
        }
        if (config.referenceType === 'uri' && !hasUri) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'referenceType uri requires uri.'
            });
        }
    });
    public readonly taskHandler = new ImageSourceNodeTaskHandler();
}
