import {
    AbstractNodeDefinition,
    NodeIoAccessor,
    buildValidationError,
    type ICostEstimate,
    type IDagError,
    type IDagNodeDefinition,
    type INodeExecutionContext,
    type TResult,
    type TPortPayload
} from '@robota-sdk/dag-core';
import { z } from 'zod';

const TransformNodeConfigSchema = z.object({
    prefix: z.string().default('')
});

/**
 * DAG node that transforms input data by optionally prepending a configured prefix to text.
 *
 * When the `text` input is present, the configured `prefix` is prepended. Otherwise,
 * all input entries are passed through to the output unchanged.
 *
 * @extends AbstractNodeDefinition
 */
export class TransformNodeDefinition extends AbstractNodeDefinition<typeof TransformNodeConfigSchema> {
    public readonly nodeType = 'transform';
    public readonly displayName = 'Transform';
    public readonly category = 'Core';
    public readonly inputs: IDagNodeDefinition['inputs'] = [
        { key: 'text', label: 'Text', order: 0, type: 'string', required: false },
        { key: 'data', label: 'Data', order: 1, type: 'object', required: false }
    ];
    public readonly outputs: IDagNodeDefinition['outputs'] = [
        { key: 'text', label: 'Text', order: 0, type: 'string', required: false },
        { key: 'data', label: 'Data', order: 1, type: 'object', required: false }
    ];
    public readonly configSchemaDefinition = TransformNodeConfigSchema;

    protected override async validateInputWithConfig(
        input: TPortPayload,
        context: INodeExecutionContext,
        _config: z.output<typeof TransformNodeConfigSchema>
    ): Promise<TResult<void, IDagError>> {
        if (Object.keys(input).length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_TRANSFORM_INPUT_REQUIRED',
                    'Transform node requires at least one input value',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        return { ok: true, value: undefined };
    }

    public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
        return { ok: true, value: { estimatedCostUsd: 0.0001 } };
    }

    protected override async executeWithConfig(
        input: TPortPayload,
        context: INodeExecutionContext,
        config: z.output<typeof TransformNodeConfigSchema>
    ): Promise<TResult<TPortPayload, IDagError>> {
        const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
        const textValue = io.getInput('text');
        if (typeof textValue === 'string') {
            io.setOutput('text', `${config.prefix}${textValue}`);
        } else {
            for (const [key, value] of Object.entries(input)) {
                io.setOutput(key, value);
            }
        }
        return { ok: true, value: io.toOutput() };
    }
}
