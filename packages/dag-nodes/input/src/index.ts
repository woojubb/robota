import {
    AbstractNodeDefinition,
    NodeIoAccessor,
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
            value: { estimatedCostUsd: 0 }
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
