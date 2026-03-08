import {
    AbstractNodeDefinition,
    BINARY_PORT_PRESETS,
    createBinaryPortDefinition,
    NodeIoAccessor,
    type ICostEstimate,
    type IDagError,
    type IDagNodeDefinition,
    type INodeExecutionContext,
    type TResult,
    type TPortPayload
} from '@robota-sdk/dag-core';
import { z } from 'zod';

const ImageLoaderConfigSchema = z.object({});

/**
 * DAG node that loads a media reference and outputs it as a binary image port value.
 *
 * Accepts an object-typed media reference on the `asset` input and converts it to
 * a binary image output via {@link MediaReference}.
 *
 * @extends AbstractNodeDefinition
 */
export class ImageLoaderNodeDefinition extends AbstractNodeDefinition<typeof ImageLoaderConfigSchema> {
    public readonly nodeType = 'image-loader';
    public readonly displayName = 'Image Loader';
    public readonly category = 'Media';
    public readonly inputs: IDagNodeDefinition['inputs'] = [
        { key: 'asset', label: 'Media Reference', order: 0, type: 'object', required: true }
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
        const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
        const referenceResult = io.requireInputMediaReference('asset');
        if (!referenceResult.ok) {
            return referenceResult;
        }

        io.setOutput('image', referenceResult.value.toBinary('image', 'image/png'));
        return {
            ok: true,
            value: io.toOutput()
        };
    }
}
