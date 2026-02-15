import {
    NodeIoAccessor,
    type IDagNodeDefinition,
    type TPortPayload,
    type TResult,
    type IDagError
} from '@robota-sdk/dag-core';
import { z } from 'zod';

class InputNodeTaskHandler {
    public async execute(input: TPortPayload): Promise<TResult<TPortPayload, IDagError>> {
        const io = new NodeIoAccessor(input, 'input');
        for (const [key, value] of Object.entries(input)) {
            io.setOutput(key, value);
        }
        return { ok: true, value: io.toOutput() };
    }
}

export class InputNodeDefinition implements IDagNodeDefinition {
    public readonly nodeType = 'input';
    public readonly displayName = 'Input';
    public readonly category = 'Core';
    public readonly inputs: IDagNodeDefinition['inputs'] = [];
    public readonly outputs: IDagNodeDefinition['outputs'] = [
        { key: 'text', label: 'Text', order: 0, type: 'string', required: false },
        { key: 'data', label: 'Data', order: 1, type: 'object', required: false }
    ];
    public readonly configSchemaDefinition = z.object({});
    public readonly taskHandler = new InputNodeTaskHandler();
}
