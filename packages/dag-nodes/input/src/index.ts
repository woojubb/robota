import { AbstractNodeDefinition, NodeIoAccessor } from '@robota-sdk/dag-node';
import {
    type ICostEstimate,
    type IDagError,
    type IDagNodeDefinition,
    type INodeExecutionContext,
    type TPortPayload,
    type TResult
} from '@robota-sdk/dag-core';
import { z } from 'zod';

const InputNodeConfigSchema = z.object({
    text: z.string().default('')
});

/**
 * DAG node that provides a static text value as output.
 *
 * The text is supplied through the node configuration and emitted on the `text` output port.
 * This node has no inputs and is typically used as a pipeline entry point.
 *
 * @extends AbstractNodeDefinition
 */
export class InputNodeDefinition extends AbstractNodeDefinition<typeof InputNodeConfigSchema> {
    public readonly nodeType = 'input';
    public readonly displayName = 'Input';
    public readonly category = 'Core';
    public readonly inputs: IDagNodeDefinition['inputs'] = [];
    public readonly outputs: IDagNodeDefinition['outputs'] = [
        { key: 'text', label: 'Text', order: 0, type: 'string', required: true }
    ];
    public readonly configSchemaDefinition = InputNodeConfigSchema;

    public override async estimateCostWithConfig(
        _input: TPortPayload,
        _context: INodeExecutionContext,
        _config: z.output<typeof InputNodeConfigSchema>
    ): Promise<TResult<ICostEstimate, IDagError>> {
        return {
            ok: true,
            value: { estimatedCredits: 0 }
        };
    }

    protected override async executeWithConfig(
        input: TPortPayload,
        _context: INodeExecutionContext,
        config: z.output<typeof InputNodeConfigSchema>
    ): Promise<TResult<TPortPayload, IDagError>> {
        const io = new NodeIoAccessor(input, 'input');
        io.setOutput('text', config.text);
        return { ok: true, value: io.toOutput() };
    }
}
