import {
    NodeIoAccessor,
    buildValidationError,
    type IDagNodeDefinition,
    type INodeExecutionContext,
    type ICostEstimate,
    type TPortPayload,
    type TResult,
    type IDagError
} from '@robota-sdk/dag-core';
import { z } from 'zod';

class TransformNodeTaskHandler {
    public async validateInput(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<void, IDagError>> {
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

    public async estimateCost(): Promise<TResult<ICostEstimate, IDagError>> {
        return { ok: true, value: { estimatedCostUsd: 0.0001 } };
    }

    public async execute(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<TPortPayload, IDagError>> {
        const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
        const prefixValue = context.nodeDefinition.config.prefix;
        const prefix = typeof prefixValue === 'string' ? prefixValue : '';
        const textValue = io.getInput('text');
        if (typeof textValue === 'string') {
            io.setOutput('text', `${prefix}${textValue}`);
        } else {
            for (const [key, value] of Object.entries(input)) {
                io.setOutput(key, value);
            }
        }
        return { ok: true, value: io.toOutput() };
    }
}

export class TransformNodeDefinition implements IDagNodeDefinition {
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
    public readonly configSchemaDefinition = z.object({
        prefix: z.string().optional()
    });
    public readonly taskHandler = new TransformNodeTaskHandler();
}
