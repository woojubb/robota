import { buildValidationError } from '../utils/error-builders.js';
import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';
import type { TPortPayload, TPortValue } from '../interfaces/ports.js';

export class NodeIoAccessor {
    private readonly output: TPortPayload = {};

    public constructor(
        private readonly input: TPortPayload,
        private readonly nodeId: string
    ) {}

    public getInput(key: string): TPortValue | undefined {
        return this.input[key];
    }

    public requireInput(key: string): TResult<TPortValue, IDagError> {
        const value = this.getInput(key);
        if (typeof value === 'undefined') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_NODE_INPUT_MISSING',
                    'Node input key is missing',
                    { nodeId: this.nodeId, key }
                )
            };
        }
        return {
            ok: true,
            value
        };
    }

    public setOutput(key: string, value: TPortValue): void {
        this.output[key] = value;
    }

    public toOutput(): TPortPayload {
        return { ...this.output };
    }
}
