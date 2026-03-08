import {
    buildTaskExecutionError,
    buildValidationError,
    type IDagError,
    type IPortBinaryValue,
    type TResult
} from '@robota-sdk/dag-core';
import { BytedanceProvider } from '@robota-sdk/bytedance';
import type { IVideoGenerationProvider, TImageInputSource } from '@robota-sdk/agents';
import { resolveImageInputSource, resolveRuntimeBaseUrl, toOutputVideo } from './runtime-helpers.js';

const DEFAULT_SEEDANCE_MODEL = 'seedance-1-5-pro-251215';

/** Configuration options for the Seedance video runtime, including API key, base URL, and model restrictions. */
export interface ISeedanceVideoRuntimeOptions {
    defaultModel?: string;
    allowedModels?: string[];
    baseUrl?: string;
    apiKey?: string;
}

/** Request payload for generating a video via the Seedance runtime. */
export interface ISeedanceGenerateVideoRequest {
    prompt: string;
    model: string;
    inputImages?: IPortBinaryValue[];
    durationSeconds?: number;
    aspectRatio?: string;
    seed?: number;
    pollIntervalMs: number;
    pollTimeoutMs: number;
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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function compactTaskErrorContext(
    context?: Record<string, string | number | boolean | undefined>
): Record<string, string | number | boolean> | undefined {
    if (!context) {
        return undefined;
    }

    const compacted: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(context)) {
        if (typeof value === 'undefined') {
            continue;
        }
        compacted[key] = value;
    }

    return Object.keys(compacted).length > 0 ? compacted : undefined;
}

/**
 * Runtime that submits video generation requests to the Seedance (Bytedance) API
 * and polls for completion.
 */
export class SeedanceVideoRuntime {
    private readonly explicitApiKey?: string;
    private readonly explicitBaseUrl?: string;
    private readonly explicitDefaultModel?: string;
    private readonly explicitAllowedModels?: string[];

    public constructor(options?: ISeedanceVideoRuntimeOptions) {
        this.explicitApiKey = options?.apiKey;
        this.explicitBaseUrl = options?.baseUrl;
        this.explicitDefaultModel = options?.defaultModel;
        this.explicitAllowedModels = options?.allowedModels;
    }

    private resolveConfig(): {
        provider: IVideoGenerationProvider | undefined;
        defaultModel: string;
        allowedModels: string[];
        runtimeBaseUrl: string;
    } {
        const defaultModelRaw = this.explicitDefaultModel ?? process.env.DAG_SEEDANCE_DEFAULT_MODEL;
        const allowedModelsRaw = this.explicitAllowedModels ?? parseCsv(process.env.DAG_SEEDANCE_ALLOWED_MODELS);
        const defaultModel = typeof defaultModelRaw === 'string' && defaultModelRaw.trim().length > 0
            ? defaultModelRaw.trim()
            : DEFAULT_SEEDANCE_MODEL;
        const allowedModels = Array.isArray(allowedModelsRaw) && allowedModelsRaw.length > 0
            ? allowedModelsRaw
            : [defaultModel];
        const apiKey = this.explicitApiKey ?? process.env.BYTEDANCE_API_KEY ?? process.env.ARK_API_KEY;
        const baseUrl = this.explicitBaseUrl ?? process.env.BYTEDANCE_BASE_URL;
        let provider: IVideoGenerationProvider | undefined;
        if (typeof apiKey === 'string' && apiKey.trim().length > 0 && typeof baseUrl === 'string' && baseUrl.trim().length > 0) {
            provider = new BytedanceProvider({
                apiKey: apiKey.trim(),
                baseUrl: baseUrl.trim()
            });
        }
        const runtimeBaseUrl = resolveRuntimeBaseUrl();
        return { provider, defaultModel, allowedModels, runtimeBaseUrl };
    }

    private mapTaskError(
        code: string,
        message: string,
        retryable: boolean,
        context?: Record<string, string | number | boolean | undefined>
    ): TResult<never, IDagError> {
        return {
            ok: false,
            error: buildTaskExecutionError(code, message, retryable, compactTaskErrorContext(context))
        };
    }

    public async generateVideo(request: ISeedanceGenerateVideoRequest): Promise<TResult<IPortBinaryValue, IDagError>> {
        const config = this.resolveConfig();
        if (!config.provider) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_BYTEDANCE_CONFIG_REQUIRED',
                    'BYTEDANCE_API_KEY(or ARK_API_KEY) and BYTEDANCE_BASE_URL must be configured for Seedance runtime'
                )
            };
        }
        const provider = config.provider;
        const selectedModel = request.model.trim().length > 0 ? request.model.trim() : config.defaultModel;
        if (config.allowedModels.length > 0 && !config.allowedModels.includes(selectedModel)) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_SEEDANCE_MODEL_NOT_ALLOWED',
                    'Selected Seedance model is not allowed in DAG runtime',
                    { model: selectedModel }
                )
            };
        }
        const prompt = request.prompt.trim();
        if (prompt.length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_SEEDANCE_PROMPT_REQUIRED',
                    'Seedance prompt must be non-empty'
                )
            };
        }

        const inputImages: TImageInputSource[] = [];
        if (Array.isArray(request.inputImages) && request.inputImages.length > 0) {
            for (const [index, image] of request.inputImages.entries()) {
                const imageSourceResult = await resolveImageInputSource(image, config.runtimeBaseUrl);
                if (!imageSourceResult.ok) {
                    return {
                        ok: false,
                        error: buildValidationError(
                            imageSourceResult.error.code,
                            imageSourceResult.error.message,
                            { index, ...imageSourceResult.error.context }
                        )
                    };
                }
                inputImages.push(imageSourceResult.value);
            }
        }

        const acceptedResult = await provider.createVideo({
            prompt,
            model: selectedModel,
            durationSeconds: request.durationSeconds,
            aspectRatio: request.aspectRatio,
            seed: request.seed,
            inputImages: inputImages.length > 0 ? inputImages : undefined
        });
        if (!acceptedResult.ok) {
            return this.mapTaskError(
                'DAG_TASK_EXECUTION_SEEDANCE_CREATE_FAILED',
                acceptedResult.error.message,
                false,
                { code: acceptedResult.error.code, model: selectedModel }
            );
        }

        const deadlineEpochMs = Date.now() + request.pollTimeoutMs;
        for (;;) {
            const snapshotResult = await provider.getVideoJob(acceptedResult.value.jobId);
            if (!snapshotResult.ok) {
                return this.mapTaskError(
                    'DAG_TASK_EXECUTION_SEEDANCE_POLL_FAILED',
                    snapshotResult.error.message,
                    false,
                    { code: snapshotResult.error.code, jobId: acceptedResult.value.jobId }
                );
            }

            const snapshot = snapshotResult.value;
            if (snapshot.status === 'succeeded') {
                return toOutputVideo(snapshot.output);
            }
            if (snapshot.status === 'failed') {
                const failedMessage = snapshot.error?.message ?? 'Seedance job failed without explicit error message';
                return this.mapTaskError(
                    'DAG_TASK_EXECUTION_SEEDANCE_JOB_FAILED',
                    failedMessage,
                    false,
                    { jobId: snapshot.jobId, status: snapshot.status }
                );
            }
            if (snapshot.status === 'cancelled') {
                return this.mapTaskError(
                    'DAG_TASK_EXECUTION_SEEDANCE_JOB_CANCELLED',
                    'Seedance job was cancelled before completion',
                    false,
                    { jobId: snapshot.jobId, status: snapshot.status }
                );
            }
            if (Date.now() >= deadlineEpochMs) {
                return this.mapTaskError(
                    'DAG_TASK_EXECUTION_SEEDANCE_TIMEOUT',
                    'Seedance video generation timed out',
                    true,
                    { jobId: snapshot.jobId, pollTimeoutMs: request.pollTimeoutMs }
                );
            }
            await sleep(request.pollIntervalMs);
        }
    }
}
