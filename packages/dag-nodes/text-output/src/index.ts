import {
    NodeIoAccessor,
    buildValidationError,
    type IDagError,
    type IDagNodeDefinition,
    type TResult,
    type TPortPayload
} from '@robota-sdk/dag-core';
import { z } from 'zod';

class TextOutputNodeTaskHandler {
    public async execute(input: TPortPayload): Promise<TResult<TPortPayload, IDagError>> {
        const io = new NodeIoAccessor(input, 'text-output');
        const textInputResult = io.requireInput('text');
        if (!textInputResult.ok) {
            return textInputResult;
        }
        if (typeof textInputResult.value !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH',
                    'text-output node input "text" must be a string.',
                    { nodeId: 'text-output', inputKey: 'text' }
                )
            };
        }
        io.setOutput('text', textInputResult.value);
        return {
            ok: true,
            value: io.toOutput()
        };
    }
}

export class TextOutputNodeDefinition implements IDagNodeDefinition {
    public readonly nodeType = 'text-output';
    public readonly displayName = 'Text Output';
    public readonly category = 'Core';
    public readonly inputs: IDagNodeDefinition['inputs'] = [
        { key: 'text', label: 'Text', order: 0, type: 'string', required: true }
    ];
    public readonly outputs: IDagNodeDefinition['outputs'] = [
        { key: 'text', label: 'Text', order: 0, type: 'string', required: true }
    ];
    public readonly configSchemaDefinition = z.object({});
    public readonly taskHandler = new TextOutputNodeTaskHandler();
}
