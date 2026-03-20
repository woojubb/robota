import { buildValidationError } from '@robota-sdk/dag-core';
import type { IPortBinaryValue, TPortPayload, TPortValue } from '@robota-sdk/dag-core';
import type { IDagError } from '@robota-sdk/dag-core';
import type { TResult } from '@robota-sdk/dag-core';
import type { IPortDefinition } from '@robota-sdk/dag-core';
import type {
    ICostEstimate,
    INodeExecutionContext,
    INodeLifecycle,
    INodeTaskHandler
} from '@robota-sdk/dag-core';

function isBinaryValue(value: TPortValue): value is IPortBinaryValue {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const candidate = value as Partial<IPortBinaryValue>;
    return (
        typeof candidate.kind === 'string'
        && typeof candidate.mimeType === 'string'
        && typeof candidate.uri === 'string'
    );
}

function isPortValueCompatible(port: IPortDefinition, value: TPortValue): boolean {
    if (port.isList) {
        if (!Array.isArray(value)) {
            return false;
        }
        return value.every((item) => isPortValueCompatible({ ...port, isList: false }, item));
    }
    switch (port.type) {
        case 'string':
            return typeof value === 'string';
        case 'number':
            return typeof value === 'number';
        case 'boolean':
            return typeof value === 'boolean';
        case 'object':
            return typeof value === 'object' && value !== null && !Array.isArray(value) && !isBinaryValue(value);
        case 'array':
            return Array.isArray(value);
        case 'binary': {
            if (!isBinaryValue(value)) {
                return false;
            }
            if (port.binaryKind && value.kind !== port.binaryKind) {
                return false;
            }
            if (port.mimeTypes && port.mimeTypes.length > 0 && !port.mimeTypes.includes(value.mimeType)) {
                return false;
            }
            return true;
        }
        default:
            return false;
    }
}

function validateRequiredPorts(
    payload: TPortPayload,
    ports: IPortDefinition[],
    mode: 'input' | 'output',
    nodeId: string
): TResult<void, IDagError> {
    for (const port of ports) {
        const value = payload[port.key];
        if (typeof value === 'undefined') {
            if (port.required) {
                return {
                    ok: false,
                    error: buildValidationError(
                        mode === 'input'
                            ? 'DAG_VALIDATION_NODE_REQUIRED_INPUT_MISSING'
                            : 'DAG_VALIDATION_NODE_REQUIRED_OUTPUT_MISSING',
                        mode === 'input'
                            ? 'Required input port value is missing'
                            : 'Required output port value is missing',
                        {
                            nodeId,
                            key: port.key,
                            type: port.type
                        }
                    )
                };
            }
            continue;
        }

        if (port.isList) {
            if (!Array.isArray(value)) {
                return {
                    ok: false,
                    error: buildValidationError(
                        mode === 'input'
                            ? 'DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH'
                            : 'DAG_VALIDATION_NODE_OUTPUT_TYPE_MISMATCH',
                        mode === 'input'
                            ? 'List input port must receive array payload'
                            : 'List output port must emit array payload',
                        { nodeId, key: port.key, type: port.type }
                    )
                };
            }
            if (typeof port.minItems === 'number' && value.length < port.minItems) {
                return {
                    ok: false,
                    error: buildValidationError(
                        mode === 'input'
                            ? 'DAG_VALIDATION_NODE_INPUT_MIN_ITEMS_NOT_SATISFIED'
                            : 'DAG_VALIDATION_NODE_OUTPUT_MIN_ITEMS_NOT_SATISFIED',
                        mode === 'input'
                            ? 'List input port does not satisfy minItems'
                            : 'List output port does not satisfy minItems',
                        { nodeId, key: port.key, minItems: port.minItems, actualItems: value.length }
                    )
                };
            }
            if (typeof port.maxItems === 'number' && value.length > port.maxItems) {
                return {
                    ok: false,
                    error: buildValidationError(
                        mode === 'input'
                            ? 'DAG_VALIDATION_NODE_INPUT_MAX_ITEMS_EXCEEDED'
                            : 'DAG_VALIDATION_NODE_OUTPUT_MAX_ITEMS_EXCEEDED',
                        mode === 'input'
                            ? 'List input port exceeds maxItems'
                            : 'List output port exceeds maxItems',
                        { nodeId, key: port.key, maxItems: port.maxItems, actualItems: value.length }
                    )
                };
            }
        }

        if (!isPortValueCompatible(port, value)) {
            return {
                ok: false,
                error: buildValidationError(
                    mode === 'input'
                        ? 'DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH'
                        : 'DAG_VALIDATION_NODE_OUTPUT_TYPE_MISMATCH',
                    mode === 'input'
                        ? 'Input port type mismatch'
                        : 'Output port type mismatch',
                    {
                        nodeId,
                        key: port.key,
                        type: port.type
                    }
                )
            };
        }
    }

    return {
        ok: true,
        value: undefined
    };
}

/**
 * {@link INodeLifecycle} implementation that delegates to an {@link INodeTaskHandler}.
 * Adds default validation for required inputs, binary ports, and output ports.
 */
export class RegisteredNodeLifecycle implements INodeLifecycle {
    public constructor(private readonly handler: INodeTaskHandler) {}

    public async initialize(context: INodeExecutionContext): Promise<TResult<void, IDagError>> {
        if (!this.handler.initialize) {
            return { ok: true, value: undefined };
        }
        return this.handler.initialize(context);
    }

    public async validateInput(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<void, IDagError>> {
        const baseValidation = validateRequiredPorts(
            input,
            context.nodeManifest.inputs,
            'input',
            context.nodeDefinition.nodeId
        );
        if (!baseValidation.ok) {
            return baseValidation;
        }

        if (!this.handler.validateInput) {
            return { ok: true, value: undefined };
        }
        return this.handler.validateInput(input, context);
    }

    public async estimateCost(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<ICostEstimate, IDagError>> {
        if (!this.handler.estimateCost) {
            return {
                ok: true,
                value: { estimatedCredits: 0 }
            };
        }
        return this.handler.estimateCost(input, context);
    }

    public async execute(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<TPortPayload, IDagError>> {
        return this.handler.execute(input, context);
    }

    public async validateOutput(output: TPortPayload, context: INodeExecutionContext): Promise<TResult<void, IDagError>> {
        const baseValidation = validateRequiredPorts(
            output,
            context.nodeManifest.outputs,
            'output',
            context.nodeDefinition.nodeId
        );
        if (!baseValidation.ok) {
            return baseValidation;
        }

        if (!this.handler.validateOutput) {
            return { ok: true, value: undefined };
        }
        return this.handler.validateOutput(output, context);
    }

    public async dispose(context: INodeExecutionContext): Promise<TResult<void, IDagError>> {
        if (!this.handler.dispose) {
            return { ok: true, value: undefined };
        }
        return this.handler.dispose(context);
    }
}
