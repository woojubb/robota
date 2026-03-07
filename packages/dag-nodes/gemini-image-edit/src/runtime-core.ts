import {
    buildTaskExecutionError,
    buildValidationError,
    type IDagError,
    type IPortBinaryValue,
    type TResult
} from '@robota-sdk/dag-core';
import { GoogleProvider } from '@robota-sdk/google';
import type { IImageGenerationProvider, IImageGenerationResult } from '@robota-sdk/agents';
import {
    normalizeImageOutput,
    parseCsv,
    resolveModel,
    resolveRuntimeBaseUrl,
    toInlineImageSource,
    type IInlineImageSource
} from './runtime-helpers.js';

const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

export interface IGeminiImageEditRequest {
    image: IPortBinaryValue;
    prompt: string;
    model: string;
}

export interface IGeminiImageComposeRequest {
    images: IPortBinaryValue[];
    prompt: string;
    model: string;
}

export interface IGeminiImageRuntimeOptions {
    apiKey?: string;
    defaultModel?: string;
    allowedModels?: string[];
}

export function isImageBinaryValue(value: Partial<IPortBinaryValue> | null | undefined): value is IPortBinaryValue {
    if (!value) {
        return false;
    }
    if (value.kind !== 'image') {
        return false;
    }
    return (
        typeof value.mimeType === 'string'
        && typeof value.uri === 'string'
    );
}

export class GeminiImageRuntime {
    private readonly provider?: IImageGenerationProvider;
    private readonly defaultModel: string;
    private readonly allowedModels: string[];
    private readonly runtimeBaseUrl: string;

    public constructor(options?: IGeminiImageRuntimeOptions) {
        const apiKeyValue = options?.apiKey ?? process.env.GEMINI_API_KEY;
        const defaultModelValue = options?.defaultModel ?? process.env.DAG_GEMINI_IMAGE_DEFAULT_MODEL;
        const allowedModelsValue = options?.allowedModels ?? parseCsv(process.env.DAG_GEMINI_IMAGE_ALLOWED_MODELS);
        this.defaultModel = typeof defaultModelValue === 'string' && defaultModelValue.trim().length > 0
            ? defaultModelValue.trim()
            : DEFAULT_GEMINI_IMAGE_MODEL;
        this.allowedModels = Array.isArray(allowedModelsValue) && allowedModelsValue.length > 0
            ? allowedModelsValue
            : [this.defaultModel];
        if (typeof apiKeyValue === 'string' && apiKeyValue.trim().length > 0) {
            this.provider = new GoogleProvider({
                apiKey: apiKeyValue.trim(),
                imageCapableModels: this.allowedModels
            });
        }
        this.runtimeBaseUrl = resolveRuntimeBaseUrl();
    }

    private getImageProviderCapability(
        methodName: 'editImage' | 'composeImage'
    ): TResult<IImageGenerationProvider, IDagError> {
        if (!this.provider || typeof this.provider[methodName] !== 'function') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_API_KEY_REQUIRED',
                    'GEMINI_API_KEY must be configured for Gemini image node runtime'
                )
            };
        }
        return {
            ok: true,
            value: this.provider
        };
    }

    private parseModel(selectedModel: string): TResult<string, IDagError> {
        return resolveModel(selectedModel, this.defaultModel, this.allowedModels);
    }

    private mapProviderFailure(
        code: 'DAG_TASK_EXECUTION_GEMINI_IMAGE_EDIT_FAILED' | 'DAG_TASK_EXECUTION_GEMINI_IMAGE_COMPOSE_FAILED',
        message: string,
        providerCode: string,
        model: string
    ): TResult<never, IDagError> {
        return {
            ok: false,
            error: buildTaskExecutionError(
                code,
                message,
                false,
                { code: providerCode, model }
            )
        };
    }

    private getFirstOutputOrError(
        result: IImageGenerationResult,
        model: string
    ): TResult<NonNullable<IImageGenerationResult['outputs'][number]>, IDagError> {
        const firstOutput = result.outputs[0];
        if (!firstOutput) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_GEMINI_IMAGE_RESPONSE_MISSING_IMAGE',
                    'Gemini image response did not include image data',
                    false,
                    { model }
                )
            };
        }
        return {
            ok: true,
            value: firstOutput
        };
    }

    private async mapInputImage(
        image: IPortBinaryValue,
        notFoundCode: string,
        notFoundMessage: string
    ): Promise<TResult<IInlineImageSource, IDagError>> {
        return toInlineImageSource({
            image,
            runtimeBaseUrl: this.runtimeBaseUrl,
            notFoundCode,
            notFoundMessage
        });
    }

    public async editImage(request: IGeminiImageEditRequest): Promise<TResult<IPortBinaryValue, IDagError>> {
        const providerCapabilityResult = this.getImageProviderCapability('editImage');
        if (!providerCapabilityResult.ok) {
            return providerCapabilityResult;
        }
        const provider = providerCapabilityResult.value;
        const modelResult = this.parseModel(request.model);
        if (!modelResult.ok) {
            return modelResult;
        }

        const imageSourceResult = await this.mapInputImage(
            request.image,
            'DAG_VALIDATION_GEMINI_IMAGE_INPUT_ASSET_NOT_FOUND',
            'Input image asset was not found or is not binary content'
        );
        if (!imageSourceResult.ok) {
            return imageSourceResult;
        }

        const result = await provider.editImage!({
            image: imageSourceResult.value,
            prompt: request.prompt,
            model: modelResult.value
        });
        if (!result.ok) {
            return this.mapProviderFailure(
                'DAG_TASK_EXECUTION_GEMINI_IMAGE_EDIT_FAILED',
                result.error.message,
                result.error.code,
                modelResult.value
            );
        }

        const outputResult = this.getFirstOutputOrError(result.value, modelResult.value);
        if (!outputResult.ok) {
            return outputResult;
        }
        return normalizeImageOutput(outputResult.value);
    }

    public async composeImages(request: IGeminiImageComposeRequest): Promise<TResult<IPortBinaryValue, IDagError>> {
        const providerCapabilityResult = this.getImageProviderCapability('composeImage');
        if (!providerCapabilityResult.ok) {
            return providerCapabilityResult;
        }
        const provider = providerCapabilityResult.value;
        const modelResult = this.parseModel(request.model);
        if (!modelResult.ok) {
            return modelResult;
        }

        if (request.images.length < 2) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_IMAGES_MIN_ITEMS',
                    'Gemini image compose requires at least two input images'
                )
            };
        }

        const composeInputs: IInlineImageSource[] = [];
        for (const [index, image] of request.images.entries()) {
            const imageSourceResult = await this.mapInputImage(
                image,
                'DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_IMAGE_ASSET_NOT_FOUND',
                'Compose image asset was not found or is not binary content'
            );
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
            composeInputs.push(imageSourceResult.value);
        }

        const result = await provider.composeImage!({
            images: composeInputs,
            prompt: request.prompt,
            model: modelResult.value
        });
        if (!result.ok) {
            return this.mapProviderFailure(
                'DAG_TASK_EXECUTION_GEMINI_IMAGE_COMPOSE_FAILED',
                result.error.message,
                result.error.code,
                modelResult.value
            );
        }

        const outputResult = this.getFirstOutputOrError(result.value, modelResult.value);
        if (!outputResult.ok) {
            return outputResult;
        }
        return normalizeImageOutput(outputResult.value);
    }
}
