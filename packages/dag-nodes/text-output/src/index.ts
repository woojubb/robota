import {
    AbstractNodeDefinition,
    NodeIoAccessor,
    type ICostEstimate,
    type IDagError,
    type IDagNodeDefinition,
    type INodeExecutionContext,
    type TResult,
    type TPortPayload
} from '@robota-sdk/dag-core';
import { z } from 'zod';

const TextOutputConfigSchema = z.object({});

/**
 * DAG node that passes through a text input to its output unchanged.
 *
 * Typically used as a terminal node to surface the final text result of a pipeline.
 *
 * @extends AbstractNodeDefinition
 */
export class TextOutputNodeDefinition extends AbstractNodeDefinition<typeof TextOutputConfigSchema> {
    public readonly nodeType = 'text-output';
    public readonly displayName = 'Text Output';
    public readonly category = 'Core';
    public readonly inputs: IDagNodeDefinition['inputs'] = [
        { key: 'text', label: 'Text', order: 0, type: 'string', required: true }
    ];
    public readonly outputs: IDagNodeDefinition['outputs'] = [
        { key: 'text', label: 'Text', order: 0, type: 'string', required: true }
    ];
    public readonly configSchemaDefinition = TextOutputConfigSchema;

    public override async estimateCostWithConfig(
        _input: TPortPayload,
        _context: INodeExecutionContext,
        _config: z.output<typeof TextOutputConfigSchema>
    ): Promise<TResult<ICostEstimate, IDagError>> {
        return {
            ok: true,
            value: { estimatedCostUsd: 0 }
        };
    }

    protected override async executeWithConfig(
        input: TPortPayload,
        _context: INodeExecutionContext,
        _config: z.output<typeof TextOutputConfigSchema>
    ): Promise<TResult<TPortPayload, IDagError>> {
        const io = new NodeIoAccessor(input, 'text-output');
        const textInputResult = io.requireInputString('text');
        if (!textInputResult.ok) {
            return textInputResult;
        }
        io.setOutput('text', textInputResult.value);
        return {
            ok: true,
            value: io.toOutput()
        };
    }
}
