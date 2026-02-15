import {
    BINARY_PORT_PRESETS,
    buildValidationError,
    createBinaryPortDefinition,
    type ICostEstimate,
    type IDagNodeDefinition,
    type INodeExecutionContext,
    type IDagError,
    type TResult,
    type TPortPayload
} from '@robota-sdk/dag-core';
import { z } from 'zod';

class ImageSourceNodeTaskHandler {
    public async estimateCost(): Promise<TResult<ICostEstimate, IDagError>> {
        return { ok: true, value: { estimatedCostUsd: 0 } };
    }

    public async execute(_input: TPortPayload, context: INodeExecutionContext): Promise<TResult<TPortPayload, IDagError>> {
        const uriValue = context.nodeDefinition.config.uri;
        if (typeof uriValue !== 'string' || uriValue.trim().length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_IMAGE_SOURCE_URI_REQUIRED',
                    'Image source node requires a non-empty config.uri',
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
                    uri: uriValue
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
        uri: z.string().min(1),
        mimeType: z.string().optional()
    });
    public readonly taskHandler = new ImageSourceNodeTaskHandler();
}
