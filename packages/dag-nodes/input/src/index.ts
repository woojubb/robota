import {
    buildValidationError,
    NodeIoAccessor,
    type IDagNodeDefinition,
    type INodeExecutionContext,
    type TPortPayload,
    type TResult,
    type IDagError
} from '@robota-sdk/dag-core';
import { z } from 'zod';

class InputNodeTaskHandler {
    public async execute(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<TPortPayload, IDagError>> {
        const io = new NodeIoAccessor(input, 'input');
        const configuredText = context.nodeDefinition.config.text;
        if (typeof configuredText !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_NODE_CONFIG_INVALID_SHAPE',
                    'Input node config.text must be a string.',
                    { nodeId: context.nodeDefinition.nodeId, key: 'text' }
                )
            };
        }
        io.setOutput('text', configuredText);
        return { ok: true, value: io.toOutput() };
    }
}

export class InputNodeDefinition implements IDagNodeDefinition {
    public readonly nodeType = 'input';
    public readonly displayName = 'Input';
    public readonly category = 'Core';
    public readonly inputs: IDagNodeDefinition['inputs'] = [];
    public readonly outputs: IDagNodeDefinition['outputs'] = [
        { key: 'text', label: 'Text', order: 0, type: 'string', required: true }
    ];
    public readonly configSchemaDefinition = z.object({
        text: z.string().default('')
    });
    public readonly taskHandler = new InputNodeTaskHandler();
}
