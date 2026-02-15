import {
    NodeIoAccessor,
    buildTaskExecutionError,
    buildValidationError,
    type ICostEstimate,
    type IDagNodeDefinition,
    type INodeExecutionContext,
    type IDagError,
    type TResult,
    type TPortPayload
} from '@robota-sdk/dag-core';
import { z } from 'zod';

class LlmTextNodeTaskHandler {
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

    public async estimateCost(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<ICostEstimate, IDagError>> {
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

export class LlmTextNodeDefinition implements IDagNodeDefinition {
    public readonly nodeType = 'llm-text';
    public readonly displayName = 'LLM Text';
    public readonly category = 'AI';
    public readonly inputs: IDagNodeDefinition['inputs'] = [
        { key: 'prompt', label: 'Prompt', order: 0, type: 'string', required: true }
    ];
    public readonly outputs: IDagNodeDefinition['outputs'] = [
        { key: 'completion', label: 'Completion', order: 0, type: 'string', required: true }
    ];
    public readonly configSchemaDefinition = z.object({
        model: z.string().optional(),
        baseCostUsd: z.number().optional()
    });
    public readonly taskHandler = new LlmTextNodeTaskHandler();
}
