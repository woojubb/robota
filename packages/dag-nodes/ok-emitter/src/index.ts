import {
    AbstractNodeDefinition,
    BINARY_PORT_PRESETS,
    NodeIoAccessor,
    createBinaryPortDefinition
} from '@robota-sdk/dag-node';
import {
    buildTaskExecutionError,
    buildValidationError,
    type ICostEstimate,
    type IDagNodeDefinition,
    type IDagError,
    type INodeExecutionContext,
    type TResult,
    type TPortPayload
} from '@robota-sdk/dag-core';
import { z } from 'zod';

function isImageBinary(input: TPortPayload): boolean {
    const image = input.image;
    if (typeof image !== 'object' || image === null) {
        return false;
    }
    if (!('kind' in image) || !('mimeType' in image) || !('uri' in image)) {
        return false;
    }
    return image.kind === 'image'
        && typeof image.mimeType === 'string'
        && typeof image.uri === 'string';
}

const OkEmitterConfigSchema = z.object({});

/**
 * DAG node used for testing that validates a binary image input and emits an "ok" status.
 *
 * Accepts a binary image on the `image` input port and outputs the string `"ok"` on
 * the `status` output port when the image is valid.
 *
 * @extends AbstractNodeDefinition
 */
export class OkEmitterNodeDefinition extends AbstractNodeDefinition<typeof OkEmitterConfigSchema> {
    public readonly nodeType = 'ok-emitter';
    public readonly displayName = 'OK Emitter';
    public readonly category = 'Test';
    public readonly inputs: IDagNodeDefinition['inputs'] = [
        createBinaryPortDefinition({
            key: 'image',
            label: 'Image Input',
            order: 0,
            required: true,
            description: 'Binary image from upstream',
            preset: BINARY_PORT_PRESETS.IMAGE_PNG
        })
    ];
    public readonly outputs: IDagNodeDefinition['outputs'] = [
        {
            key: 'status',
            label: 'Status',
            order: 0,
            type: 'string',
            required: true,
            description: 'Execution status'
        }
    ];
    public readonly configSchemaDefinition = OkEmitterConfigSchema;

    protected override async validateInputWithConfig(
        input: TPortPayload,
        context: INodeExecutionContext,
        _config: z.output<typeof OkEmitterConfigSchema>
    ): Promise<TResult<void, IDagError>> {
        if (!isImageBinary(input)) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_OK_EMITTER_IMAGE_REQUIRED',
                    'OK emitter node requires an image binary input',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        return { ok: true, value: undefined };
    }

    public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
        return { ok: true, value: { estimatedCostUsd: 0 } };
    }

    protected override async executeWithConfig(
        input: TPortPayload,
        _context: INodeExecutionContext,
        _config: z.output<typeof OkEmitterConfigSchema>
    ): Promise<TResult<TPortPayload, IDagError>> {
        const io = new NodeIoAccessor(input, 'ok-emitter');
        const requiredImage = io.requireInput('image');
        if (!requiredImage.ok) {
            return requiredImage;
        }
        if (!isImageBinary({ image: requiredImage.value })) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_OK_EMITTER_IMAGE_INVALID',
                    'OK emitter execution requires image binary input',
                    false
                )
            };
        }
        io.setOutput('status', 'ok');
        return {
            ok: true,
            value: io.toOutput()
        };
    }
}
