import { AbstractNodeDefinition, NodeIoAccessor } from '@robota-sdk/dag-node';
import {
    buildTaskExecutionError,
    buildValidationError,
    type ICostEstimate,
    type IDagError,
    type IDagNodeDefinition,
    type INodeExecutionContext,
    type TResult,
    type TPortPayload
} from '@robota-sdk/dag-core';
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import { z } from 'zod';

const DEFAULT_OPENAI_LLM_MODEL = 'gpt-4o-mini';
const DEFAULT_TEMPERATURE = 0.2;
const CHARS_PER_TOKEN_ESTIMATE = 1000;
const COST_PER_TOKEN_USD = 0.001;

const LlmTextOpenAiConfigSchema = z.object({
    model: z.string().default(DEFAULT_OPENAI_LLM_MODEL),
    temperature: z.number().default(DEFAULT_TEMPERATURE),
    maxTokens: z.number().int().positive().optional(),
    baseCredits: z.number().default(0)
});

/** Options for constructing a {@link LlmTextOpenAiNodeDefinition}, including model restrictions. */
export interface ILlmTextOpenAiNodeDefinitionOptions {
    defaultModel?: string;
    allowedModels?: string[];
}

/**
 * DAG node that generates text completions using the OpenAI API.
 *
 * Accepts a text prompt and produces a completion via a Robota agent backed by {@link OpenAIProvider}.
 * Model, temperature, and max tokens are configurable.
 *
 * @extends AbstractNodeDefinition
 */
export class LlmTextOpenAiNodeDefinition extends AbstractNodeDefinition<typeof LlmTextOpenAiConfigSchema> {
    public readonly nodeType = 'llm-text-openai';
    public readonly displayName = 'LLM Text OpenAI';
    public readonly category = 'AI';
    public readonly inputs: IDagNodeDefinition['inputs'] = [
        { key: 'prompt', label: 'Prompt', order: 0, type: 'string', required: true }
    ];
    public readonly outputs: IDagNodeDefinition['outputs'] = [
        { key: 'completion', label: 'Completion', order: 0, type: 'string', required: true }
    ];
    public readonly configSchemaDefinition = LlmTextOpenAiConfigSchema;

    private readonly apiKeyEnvName = 'OPENAI_API_KEY';
    private readonly explicitApiKey?: string;
    private readonly defaultModel: string;
    private readonly allowedModels: string[];

    public constructor(options?: ILlmTextOpenAiNodeDefinitionOptions) {
        super();
        this.explicitApiKey = undefined;
        this.defaultModel = typeof options?.defaultModel === 'string' && options.defaultModel.trim().length > 0
            ? options.defaultModel.trim()
            : DEFAULT_OPENAI_LLM_MODEL;
        this.allowedModels = Array.isArray(options?.allowedModels) && options.allowedModels.length > 0
            ? options.allowedModels
            : [this.defaultModel];
    }

    private resolveProvider(): OpenAIProvider | undefined {
        const apiKey = this.explicitApiKey ?? process.env[this.apiKeyEnvName];
        if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
            return new OpenAIProvider({ apiKey: apiKey.trim() });
        }
        return undefined;
    }

    private resolveModel(modelFromConfig: string): TResult<string, IDagError> {
        const selectedModel = modelFromConfig.trim().length > 0
            ? modelFromConfig.trim()
            : this.defaultModel;
        if (this.allowedModels.length > 0 && !this.allowedModels.includes(selectedModel)) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_LLM_MODEL_NOT_ALLOWED',
                    'Selected model is not allowed for llm-text-openai node',
                    { model: selectedModel }
                )
            };
        }
        return {
            ok: true,
            value: selectedModel
        };
    }

    protected override async validateInputWithConfig(
        input: TPortPayload,
        context: INodeExecutionContext,
        config: z.output<typeof LlmTextOpenAiConfigSchema>
    ): Promise<TResult<void, IDagError>> {
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
        const modelResult = this.resolveModel(config.model);
        if (!modelResult.ok) {
            return modelResult;
        }
        return { ok: true, value: undefined };
    }

    public override async estimateCostWithConfig(
        input: TPortPayload,
        context: INodeExecutionContext,
        config: z.output<typeof LlmTextOpenAiConfigSchema>
    ): Promise<TResult<ICostEstimate, IDagError>> {
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
        const estimatedCredits = config.baseCredits + (prompt.length / CHARS_PER_TOKEN_ESTIMATE) * COST_PER_TOKEN_USD;
        return {
            ok: true,
            value: { estimatedCredits }
        };
    }

    protected override async executeWithConfig(
        input: TPortPayload,
        context: INodeExecutionContext,
        config: z.output<typeof LlmTextOpenAiConfigSchema>
    ): Promise<TResult<TPortPayload, IDagError>> {
        const provider = this.resolveProvider();
        if (!provider) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_OPENAI_API_KEY_REQUIRED',
                    'OPENAI_API_KEY must be configured for llm-text-openai node'
                )
            };
        }
        const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
        const promptResult = io.requireInputString('prompt');
        if (!promptResult.ok || promptResult.value.trim().length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_LLM_PROMPT_REQUIRED',
                    'LLM node requires a non-empty prompt input',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const modelResult = this.resolveModel(config.model);
        if (!modelResult.ok) {
            return modelResult;
        }

        const agent = new Robota({
            name: 'DagLlmTextOpenAiNodeAgent',
            aiProviders: [provider],
            defaultModel: {
                provider: 'openai',
                model: modelResult.value,
                ...(typeof config.temperature === 'number' ? { temperature: config.temperature } : {}),
                ...(typeof config.maxTokens === 'number' ? { maxTokens: config.maxTokens } : {})
            }
        });

        try {
            const completion = await agent.run(promptResult.value);
            io.setOutput('completion', completion);
            return {
                ok: true,
                value: io.toOutput()
            };
        } catch (error) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_LLM_GENERATION_FAILED',
                    error instanceof Error ? error.message : 'LLM generation failed',
                    true,
                    { provider: 'openai', model: modelResult.value }
                )
            };
        }
    }
}

