import { buildTaskExecutionError, buildValidationError } from '../utils/error-builders.js';
import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';
import type {
    INodeExecutionContext,
    INodeTaskHandler,
    INodeTaskHandlerRegistry
} from '../types/node-lifecycle.js';
import type { TPortPayload } from '../interfaces/ports.js';
import { NodeIoAccessor } from './node-io-accessor.js';

export class InputNodeTaskHandler implements INodeTaskHandler {
    public async execute(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<TPortPayload, IDagError>> {
        const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
        for (const [key, value] of Object.entries(input)) {
            io.setOutput(key, value);
        }
        return { ok: true, value: io.toOutput() };
    }
}

export class TransformNodeTaskHandler implements INodeTaskHandler {
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

    public async estimateCost(): Promise<TResult<{ estimatedCostUsd: number }, IDagError>> {
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

export class LlmTextNodeTaskHandler implements INodeTaskHandler {
    public async validateInput(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<void, IDagError>> {
        if (typeof input.prompt !== 'string' || input.prompt.trim().length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_LLM_PROMPT_REQUIRED',
                    'LLM node requires a non-empty prompt input',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        return { ok: true, value: undefined };
    }

    public async estimateCost(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<{ estimatedCostUsd: number }, IDagError>> {
        const prompt = input.prompt;
        if (typeof prompt !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_LLM_PROMPT_INVALID',
                    'prompt must be string for cost estimation',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }

        const baseCostValue = context.nodeDefinition.config.baseCostUsd;
        const baseCostUsd = typeof baseCostValue === 'number' ? baseCostValue : 0.002;
        const estimatedCostUsd = baseCostUsd + (prompt.length / 1000) * 0.001;
        return { ok: true, value: { estimatedCostUsd } };
    }

    public async execute(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<TPortPayload, IDagError>> {
        const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
        const promptResult = io.requireInput('prompt');
        if (!promptResult.ok) {
            return promptResult;
        }
        const prompt = promptResult.value;
        if (typeof prompt !== 'string') {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_LLM_PROMPT_INVALID',
                    'LLM execution requires string prompt',
                    false
                )
            };
        }

        io.setOutput('completion', `preview:${prompt}`);
        return {
            ok: true,
            value: io.toOutput()
        };
    }
}

export class StaticNodeTaskHandlerRegistry implements INodeTaskHandlerRegistry {
    public constructor(private readonly handlersByType: Record<string, INodeTaskHandler>) {}

    public getHandler(nodeType: string): INodeTaskHandler | undefined {
        return this.handlersByType[nodeType];
    }

    public listNodeTypes(): string[] {
        return Object.keys(this.handlersByType);
    }
}

export function createDefaultNodeTaskHandlerRegistry(): StaticNodeTaskHandlerRegistry {
    return new StaticNodeTaskHandlerRegistry({
        input: new InputNodeTaskHandler(),
        transform: new TransformNodeTaskHandler(),
        'llm-text': new LlmTextNodeTaskHandler()
    });
}
