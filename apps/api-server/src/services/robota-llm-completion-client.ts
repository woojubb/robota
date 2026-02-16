import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { GoogleProvider } from '@robota-sdk/google';
import {
    buildTaskExecutionError,
    buildValidationError,
    type IDagError,
    type TResult
} from '@robota-sdk/dag-core';
import type {
    ILlmTextCompletionClient,
    ILlmTextGenerationRequest,
    ILlmTextModelSelection,
    ILlmTextResolvedModelSelection
} from '@robota-sdk/dag-node-llm-text';

type TRobotaProviderInstance = OpenAIProvider | AnthropicProvider | GoogleProvider;

interface IRobotaLlmRuntimeOptions {
    providersByName: Record<string, TRobotaProviderInstance>;
    defaultProvider: string;
    defaultModelByProvider: Record<string, string>;
    allowedModelsByProvider: Record<string, string[]>;
}

function parseCsv(value: string | undefined): string[] {
    if (typeof value !== 'string') {
        return [];
    }
    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function normalizeProviderName(value: string | undefined): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : undefined;
}

export class RobotaLlmCompletionClient implements ILlmTextCompletionClient {
    private readonly options: IRobotaLlmRuntimeOptions;

    constructor(options: IRobotaLlmRuntimeOptions) {
        this.options = options;
    }

    public resolveModelSelection(selection: ILlmTextModelSelection): TResult<ILlmTextResolvedModelSelection, IDagError> {
        const selectedProvider = normalizeProviderName(selection.provider) ?? this.options.defaultProvider;
        const selectedProviderInstance = this.options.providersByName[selectedProvider];
        if (!selectedProviderInstance) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_LLM_PROVIDER_NOT_AVAILABLE',
                    'Selected provider is not available in DAG server runtime',
                    { provider: selectedProvider }
                )
            };
        }

        const selectedModel = selection.model ?? this.options.defaultModelByProvider[selectedProvider];
        if (typeof selectedModel !== 'string' || selectedModel.trim().length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_LLM_MODEL_REQUIRED',
                    'Model is required because no default model is configured for selected provider',
                    { provider: selectedProvider }
                )
            };
        }

        const allowedModels = this.options.allowedModelsByProvider[selectedProvider] ?? [];
        if (allowedModels.length > 0 && !allowedModels.includes(selectedModel)) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_LLM_MODEL_NOT_ALLOWED',
                    'Selected model is not allowed for selected provider',
                    { provider: selectedProvider, model: selectedModel }
                )
            };
        }

        return {
            ok: true,
            value: {
                provider: selectedProvider,
                model: selectedModel
            }
        };
    }

    public async generateCompletion(request: ILlmTextGenerationRequest): Promise<TResult<string, IDagError>> {
        const providerInstance = this.options.providersByName[request.provider];
        if (!providerInstance) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_LLM_PROVIDER_NOT_AVAILABLE',
                    'Selected provider is not available in DAG server runtime',
                    { provider: request.provider }
                )
            };
        }

        const agent = new Robota({
            name: 'DagLlmTextNodeAgent',
            aiProviders: [providerInstance],
            defaultModel: {
                provider: request.provider,
                model: request.model,
                ...(typeof request.temperature === 'number' ? { temperature: request.temperature } : {}),
                ...(typeof request.maxTokens === 'number' ? { maxTokens: request.maxTokens } : {})
            }
        });

        try {
            const completion = await agent.run(request.prompt);
            return {
                ok: true,
                value: completion
            };
        } catch (error) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_LLM_GENERATION_FAILED',
                    error instanceof Error ? error.message : 'LLM generation failed',
                    true,
                    { provider: request.provider, model: request.model }
                )
            };
        }
    }
}

export function createRobotaLlmCompletionClientFromEnv(): RobotaLlmCompletionClient {
    const providersByName: Record<string, TRobotaProviderInstance> = {};

    if (typeof process.env.OPENAI_API_KEY === 'string' && process.env.OPENAI_API_KEY.trim().length > 0) {
        providersByName.openai = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
    }
    if (typeof process.env.ANTHROPIC_API_KEY === 'string' && process.env.ANTHROPIC_API_KEY.trim().length > 0) {
        providersByName.anthropic = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    if (typeof process.env.GOOGLE_API_KEY === 'string' && process.env.GOOGLE_API_KEY.trim().length > 0) {
        providersByName.google = new GoogleProvider({ apiKey: process.env.GOOGLE_API_KEY });
    }

    const availableProviders = Object.keys(providersByName);
    const configuredDefaultProvider = normalizeProviderName(process.env.DAG_LLM_DEFAULT_PROVIDER);
    const defaultProvider = configuredDefaultProvider ?? (availableProviders[0] ?? 'openai');

    const defaultModelByProvider: Record<string, string> = {};
    const openaiDefaultModel = process.env.DAG_LLM_DEFAULT_OPENAI_MODEL;
    const anthropicDefaultModel = process.env.DAG_LLM_DEFAULT_ANTHROPIC_MODEL;
    const googleDefaultModel = process.env.DAG_LLM_DEFAULT_GOOGLE_MODEL;
    const globalDefaultModel = process.env.DAG_LLM_DEFAULT_MODEL;

    if (typeof openaiDefaultModel === 'string' && openaiDefaultModel.trim().length > 0) {
        defaultModelByProvider.openai = openaiDefaultModel.trim();
    }
    if (typeof anthropicDefaultModel === 'string' && anthropicDefaultModel.trim().length > 0) {
        defaultModelByProvider.anthropic = anthropicDefaultModel.trim();
    }
    if (typeof googleDefaultModel === 'string' && googleDefaultModel.trim().length > 0) {
        defaultModelByProvider.google = googleDefaultModel.trim();
    }
    if (
        typeof globalDefaultModel === 'string' &&
        globalDefaultModel.trim().length > 0 &&
        typeof defaultModelByProvider[defaultProvider] === 'undefined'
    ) {
        defaultModelByProvider[defaultProvider] = globalDefaultModel.trim();
    }

    const allowedModelsByProvider: Record<string, string[]> = {
        openai: parseCsv(process.env.DAG_LLM_ALLOWED_OPENAI_MODELS),
        anthropic: parseCsv(process.env.DAG_LLM_ALLOWED_ANTHROPIC_MODELS),
        google: parseCsv(process.env.DAG_LLM_ALLOWED_GOOGLE_MODELS)
    };

    return new RobotaLlmCompletionClient({
        providersByName,
        defaultProvider,
        defaultModelByProvider,
        allowedModelsByProvider
    });
}
