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

/** Request payload for editing a single image via the Gemini runtime. */
export interface IGeminiImageEditRequest {
    image: IPortBinaryValue;
    prompt: string;
    model: string;
}

/** Request payload for composing multiple images via the Gemini runtime. */
export interface IGeminiImageComposeRequest {
    images: IPortBinaryValue[];
    prompt: string;
    model: string;
}

/** Configuration options for the Gemini image runtime, including API key and model restrictions. */
export interface IGeminiImageRuntimeOptions {
    apiKey?: string;
    defaultModel?: string;
    allowedModels?: string[];
}

/**
 * Type guard that checks whether a value is a valid image binary port value.
 *
 * @param value - The value to check.
 * @returns `true` if the value has `kind: 'image'`, a `mimeType`, and a `uri`.
 */
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

/**
 * Runtime that delegates image editing and composition requests to the Google Gemini API
 * via the GoogleProvider.
 */
export class GeminiImageRuntime {
    private readonly explicitApiKey?: string;
    private readonly explicitDefaultModel?: string;
    private readonly explicitAllowedModels?: string[];

    public constructor(options?: IGeminiImageRuntimeOptions) {
        this.explicitApiKey = options?.apiKey;
        this.explicitDefaultModel = options?.defaultModel;
        this.explicitAllowedModels = options?.allowedModels;
    }

    private resolveDefaultModel(): string {
        const defaultModelValue = this.explicitDefaultModel ?? process.env.DAG_GEMINI_IMAGE_DEFAULT_MODEL;
        return typeof defaultModelValue === 'string' && defaultModelValue.trim().length > 0
            ? defaultModelValue.trim()
            : DEFAULT_GEMINI_IMAGE_MODEL;
    }

    private resolveAllowedModels(defaultModel: string): string[] {
        const allowedModelsValue = this.explicitAllowedModels ?? parseCsv(process.env.DAG_GEMINI_IMAGE_ALLOWED_MODELS);
        return Array.isArray(allowedModelsValue) && allowedModelsValue.length > 0
            ? allowedModelsValue
            : [defaultModel];
    }

    private resolveProvider(allowedModels: string[]): IImageGenerationProvider | undefined {
        const apiKeyValue = this.explicitApiKey ?? process.env.GEMINI_API_KEY;
        if (typeof apiKeyValue === 'string' && apiKeyValue.trim().length > 0) {
            return new GoogleProvider({
                apiKey: apiKeyValue.trim(),
                imageCapableModels: allowedModels
            });
        }
        return undefined;
    }

    private getImageProviderCapability(
        provider: IImageGenerationProvider | undefined,
        methodName: 'editImage' | 'composeImage'
    ): TResult<IImageGenerationProvider, IDagError> {
        if (!provider || typeof provider[methodName] !== 'function') {
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
            value: provider
        };
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
        runtimeBaseUrl: string,
        notFoundCode: string,
        notFoundMessage: string
    ): Promise<TResult<IInlineImageSource, IDagError>> {
        return toInlineImageSource({
            image,
            runtimeBaseUrl,
            notFoundCode,
            notFoundMessage
        });
    }

    public async editImage(request: IGeminiImageEditRequest): Promise<TResult<IPortBinaryValue, IDagError>> {
        const defaultModel = this.resolveDefaultModel();
        const allowedModels = this.resolveAllowedModels(defaultModel);
        const resolvedProvider = this.resolveProvider(allowedModels);
        const providerCapabilityResult = this.getImageProviderCapability(resolvedProvider, 'editImage');
        if (!providerCapabilityResult.ok) {
            return providerCapabilityResult;
        }
        const provider = providerCapabilityResult.value;
        const modelResult = resolveModel(request.model, defaultModel, allowedModels);
        if (!modelResult.ok) {
            return modelResult;
        }

        const runtimeBaseUrl = resolveRuntimeBaseUrl();
        const imageSourceResult = await this.mapInputImage(
            request.image,
            runtimeBaseUrl,
            'DAG_VALIDATION_GEMINI_IMAGE_INPUT_ASSET_NOT_FOUND',
            'Input image asset was not found or is not binary content'
        );
        if (!imageSourceResult.ok) {
            return imageSourceResult;
        }

        const editImageFn = provider.editImage;
        if (!editImageFn) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_GEMINI_IMAGE_EDIT_FAILED',
                    'Provider does not support editImage capability',
                    false,
                    { model: modelResult.value }
                )
            };
        }
        const result = await editImageFn.call(provider, {
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
        const defaultModel = this.resolveDefaultModel();
        const allowedModels = this.resolveAllowedModels(defaultModel);
        const resolvedProvider = this.resolveProvider(allowedModels);
        const providerCapabilityResult = this.getImageProviderCapability(resolvedProvider, 'composeImage');
        if (!providerCapabilityResult.ok) {
            return providerCapabilityResult;
        }
        const provider = providerCapabilityResult.value;
        const modelResult = resolveModel(request.model, defaultModel, allowedModels);
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

        const runtimeBaseUrl = resolveRuntimeBaseUrl();
        const composeInputs: IInlineImageSource[] = [];
        for (const [index, image] of request.images.entries()) {
            const imageSourceResult = await this.mapInputImage(
                image,
                runtimeBaseUrl,
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

        const composeImageFn = provider.composeImage;
        if (!composeImageFn) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_GEMINI_IMAGE_COMPOSE_FAILED',
                    'Provider does not support composeImage capability',
                    false,
                    { model: modelResult.value }
                )
            };
        }
        const result = await composeImageFn.call(provider, {
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
