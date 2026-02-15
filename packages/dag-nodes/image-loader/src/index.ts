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

class ImageLoaderNodeTaskHandler {
    public async estimateCost(): Promise<TResult<ICostEstimate, IDagError>> {
        return { ok: true, value: { estimatedCostUsd: 0 } };
    }

    public async execute(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<TPortPayload, IDagError>> {
        const uriValue = input.uri;
        if (typeof uriValue !== 'string' || uriValue.trim().length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_IMAGE_LOADER_URI_REQUIRED',
                    'Image loader node requires a non-empty input uri',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }

        return {
            ok: true,
            value: {
                image: {
                    kind: 'image',
                    mimeType: 'image/png',
                    uri: uriValue
                }
            }
        };
    }
}

export class ImageLoaderNodeDefinition implements IDagNodeDefinition {
    public readonly nodeType = 'image-loader';
    public readonly displayName = 'Image Loader';
    public readonly category = 'Media';
    public readonly inputs: IDagNodeDefinition['inputs'] = [
        { key: 'uri', label: 'Source URI', order: 0, type: 'string', required: true }
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
    public readonly configSchemaDefinition = z.object({});
    public readonly taskHandler = new ImageLoaderNodeTaskHandler();
}
