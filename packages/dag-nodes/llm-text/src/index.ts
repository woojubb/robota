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

export interface ILlmTextResolvedModelSelection {
    provider: string;
    model: string;
}

export interface ILlmTextModelSelection {
    provider?: string;
    model?: string;
}

export interface ILlmTextGenerationRequest extends ILlmTextResolvedModelSelection {
    prompt: string;
    temperature?: number;
    maxTokens?: number;
}

export interface ILlmTextCompletionClient {
    resolveModelSelection(selection: ILlmTextModelSelection): TResult<ILlmTextResolvedModelSelection, IDagError>;
    generateCompletion(request: ILlmTextGenerationRequest): Promise<TResult<string, IDagError>>;
}

interface ILlmTextExecutionOptions extends ILlmTextModelSelection {
    temperature?: number;
    maxTokens?: number;
}

class LlmTextNodeTaskHandler {
    private readonly completionClient: ILlmTextCompletionClient;

    constructor(completionClient: ILlmTextCompletionClient) {
        this.completionClient = completionClient;
    }

    private readExecutionOptions(context: INodeExecutionContext): TResult<ILlmTextExecutionOptions, IDagError> {
        const { config } = context.nodeDefinition;

        const providerValue = config.provider;
        if (typeof providerValue !== 'undefined' && typeof providerValue !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_LLM_PROVIDER_INVALID',
                    'provider must be a string when configured',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }

        const modelValue = config.model;
        if (typeof modelValue !== 'undefined' && typeof modelValue !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_LLM_MODEL_INVALID',
                    'model must be a string when configured',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }

        const temperatureValue = config.temperature;
        if (typeof temperatureValue !== 'undefined' && typeof temperatureValue !== 'number') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_LLM_TEMPERATURE_INVALID',
                    'temperature must be a number when configured',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }

        const maxTokensValue = config.maxTokens;
        if (typeof maxTokensValue !== 'undefined' && typeof maxTokensValue !== 'number') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_LLM_MAXTOKENS_INVALID',
                    'maxTokens must be a number when configured',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }

        return {
            ok: true,
            value: {
                provider: providerValue,
                model: modelValue,
                temperature: temperatureValue,
                maxTokens: maxTokensValue
            }
        };
    }

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

        const executionOptionsResult = this.readExecutionOptions(context);
        if (!executionOptionsResult.ok) {
            return executionOptionsResult;
        }

        const modelSelectionResult = this.completionClient.resolveModelSelection({
            provider: executionOptionsResult.value.provider,
            model: executionOptionsResult.value.model
        });
        if (!modelSelectionResult.ok) {
            return modelSelectionResult;
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

        const executionOptionsResult = this.readExecutionOptions(context);
        if (!executionOptionsResult.ok) {
            return executionOptionsResult;
        }

        const baseCostValue = context.nodeDefinition.config.baseCostUsd;
        let baseCostUsd = 0.002;
        if (typeof baseCostValue !== 'undefined') {
            if (typeof baseCostValue !== 'number') {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_LLM_BASE_COST_INVALID',
                        'baseCostUsd must be a number when configured',
                        { nodeId: context.nodeDefinition.nodeId }
                    )
                };
            }
            baseCostUsd = baseCostValue;
        }
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

        const executionOptionsResult = this.readExecutionOptions(context);
        if (!executionOptionsResult.ok) {
            return executionOptionsResult;
        }

        const modelSelectionResult = this.completionClient.resolveModelSelection({
            provider: executionOptionsResult.value.provider,
            model: executionOptionsResult.value.model
        });
        if (!modelSelectionResult.ok) {
            return modelSelectionResult;
        }

        const completionResult = await this.completionClient.generateCompletion({
            prompt,
            provider: modelSelectionResult.value.provider,
            model: modelSelectionResult.value.model,
            temperature: executionOptionsResult.value.temperature,
            maxTokens: executionOptionsResult.value.maxTokens
        });
        if (!completionResult.ok) {
            return completionResult;
        }

        io.setOutput('completion', completionResult.value);
        return {
            ok: true,
            value: io.toOutput()
        };
    }
}

export interface ILlmTextNodeDefinitionOptions {
    completionClient: ILlmTextCompletionClient;
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
        provider: z.string().optional(),
        model: z.string().optional(),
        temperature: z.number().optional(),
        maxTokens: z.number().int().positive().optional(),
        baseCostUsd: z.number().optional()
    });
    public readonly taskHandler: LlmTextNodeTaskHandler;

    constructor(options: ILlmTextNodeDefinitionOptions) {
        this.taskHandler = new LlmTextNodeTaskHandler(options.completionClient);
    }
}
