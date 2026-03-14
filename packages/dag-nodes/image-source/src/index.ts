import {
    AbstractNodeDefinition,
    BINARY_PORT_PRESETS,
    createMediaReferenceConfigSchema,
    createBinaryPortDefinition,
    MediaReference
} from '@robota-sdk/dag-node';
import {
    type ICostEstimate,
    type IDagNodeDefinition,
    type IDagError,
    type INodeExecutionContext,
    type TResult,
    type TPortPayload
} from '@robota-sdk/dag-core';
import { z } from 'zod';

const ImageSourceConfigSchema = createMediaReferenceConfigSchema().extend({
    mimeType: z.string().optional()
});

/**
 * DAG node that produces a binary image output from a configured asset reference.
 *
 * Designed for testing and static image injection into a DAG pipeline. The asset
 * reference and optional MIME type are provided through node configuration.
 *
 * @extends AbstractNodeDefinition
 */
export class ImageSourceNodeDefinition extends AbstractNodeDefinition<typeof ImageSourceConfigSchema> {
    public readonly nodeType = 'image-source';
    public readonly displayName = 'Image Source';
    public readonly category = 'Test';
    public readonly inputs: IDagNodeDefinition['inputs'] = [];
    public readonly outputs: IDagNodeDefinition['outputs'] = [
        createBinaryPortDefinition({
            key: 'image',
            label: 'Image',
            order: 0,
            required: true,
            description: 'Test image output',
            preset: BINARY_PORT_PRESETS.IMAGE_PNG
        })
    ];
    public readonly configSchemaDefinition = ImageSourceConfigSchema;

    public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
        return { ok: true, value: { estimatedCostUsd: 0 } };
    }

    protected override async executeWithConfig(
        _input: TPortPayload,
        _context: INodeExecutionContext,
        config: z.output<typeof ImageSourceConfigSchema>
    ): Promise<TResult<TPortPayload, IDagError>> {
        const reference = MediaReference.fromAssetReference(config.asset);

        const mimeTypeValue = typeof config.mimeType === 'string'
            ? config.mimeType
            : reference.mediaType();
        const mimeType = typeof mimeTypeValue === 'string' && mimeTypeValue.trim().length > 0
            ? mimeTypeValue
            : 'image/png';

        return {
            ok: true,
            value: {
                image: reference.toBinary('image', mimeType)
            }
        };
    }
}
