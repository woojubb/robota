import {
    AbstractNodeDefinition,
    BINARY_PORT_PRESETS,
    buildValidationError,
    createBinaryPortDefinition,
    type ICostEstimate,
    type IDagError,
    type IDagNodeDefinition,
    type INodeExecutionContext,
    type TResult,
    type TPortPayload
} from '@robota-sdk/dag-core';
import { z } from 'zod';

const ImageLoaderConfigSchema = z.object({
    referenceType: z.enum(['asset', 'uri']).optional(),
    assetId: z.string().min(1).optional(),
    uri: z.string().min(1).optional()
}).superRefine((config, ctx) => {
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

export class ImageLoaderNodeDefinition extends AbstractNodeDefinition<typeof ImageLoaderConfigSchema> {
    public readonly nodeType = 'image-loader';
    public readonly displayName = 'Image Loader';
    public readonly category = 'Media';
    public readonly inputs: IDagNodeDefinition['inputs'] = [
        { key: 'assetId', label: 'Asset ID', order: 0, type: 'string', required: false },
        { key: 'uri', label: 'Source URI', order: 1, type: 'string', required: false }
    ];
    public readonly outputs: IDagNodeDefinition['outputs'] = [
        createBinaryPortDefinition({
            key: 'image',
            label: 'Image',
            order: 0,
            required: true,
            preset: BINARY_PORT_PRESETS.IMAGE_COMMON
        })
    ];
    public readonly configSchemaDefinition = ImageLoaderConfigSchema;

    public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
        return { ok: true, value: { estimatedCostUsd: 0 } };
    }

    protected override async executeWithConfig(
        input: TPortPayload,
        context: INodeExecutionContext,
        _config: z.output<typeof ImageLoaderConfigSchema>
    ): Promise<TResult<TPortPayload, IDagError>> {
        const assetIdValue = input.assetId;
        const uriValue = input.uri;
        const hasAssetId = typeof assetIdValue === 'string' && assetIdValue.trim().length > 0;
        const hasUri = typeof uriValue === 'string' && uriValue.trim().length > 0;
        if (hasAssetId === hasUri) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_IMAGE_LOADER_REFERENCE_XOR_REQUIRED',
                    'Image loader node requires exactly one of input assetId or uri',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }

        if (hasAssetId && typeof assetIdValue === 'string') {
            const resolvedAssetId = assetIdValue;
            return {
                ok: true,
                value: {
                    image: {
                        kind: 'image',
                        mimeType: 'image/png',
                        uri: `asset://${resolvedAssetId}`,
                        referenceType: 'asset',
                        assetId: resolvedAssetId
                    }
                }
            };
        }

        if (typeof uriValue !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_IMAGE_LOADER_URI_INVALID',
                    'Image loader node input uri must be string',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const resolvedUri = uriValue;
        return {
            ok: true,
            value: {
                image: {
                    kind: 'image',
                    mimeType: 'image/png',
                    uri: resolvedUri,
                    referenceType: 'uri'
                }
            }
        };
    }
}
