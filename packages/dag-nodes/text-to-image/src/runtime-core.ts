import {
  buildTaskExecutionError,
  buildValidationError,
  type IDagError,
  type IPortBinaryValue,
  type TResult,
} from '@robota-sdk/dag-core';
import { createImageProviderFromDefinition } from '@robota-sdk/agent-core';
import type {
  IImageGenerationProvider,
  IImageGenerationResult,
  IMediaProviderDefinition,
} from '@robota-sdk/agent-core';
import { normalizeImageOutput } from './image-output-normalizer.js';

/** Request payload for generating an image from a text prompt. */
export interface ITextToImageRequest {
  prompt: string;
  model: string;
}

/** Configuration options for the text-to-image runtime, including API key and model restrictions. */
export interface ITextToImageRuntimeOptions {
  imageProviderDefinition?: IMediaProviderDefinition;
  defaultModel?: string;
  allowedModels?: readonly string[];
}

/**
 * Resolves and validates a model identifier against the allowed model list.
 */
function resolveModel(
  selectedModel: string,
  defaultModel: string,
  allowedModels: readonly string[],
): TResult<string, IDagError> {
  const model = selectedModel.trim().length > 0 ? selectedModel.trim() : defaultModel;
  if (allowedModels.length > 0 && !allowedModels.includes(model)) {
    return {
      ok: false,
      error: buildValidationError(
        'DAG_VALIDATION_TEXT_TO_IMAGE_MODEL_NOT_ALLOWED',
        'Selected text-to-image model is not allowed in DAG runtime',
        { model },
      ),
    };
  }
  return { ok: true, value: model };
}

/**
 * Runtime that delegates text-to-image generation to the capability supplied by the injected media
 * definition. Unlike the image-edit runtime, it takes no input image.
 */
export class TextToImageRuntime {
  private readonly definition?: IMediaProviderDefinition;
  private readonly explicitDefaultModel?: string;
  private readonly explicitAllowedModels?: readonly string[];

  public constructor(options?: ITextToImageRuntimeOptions) {
    this.definition = options?.imageProviderDefinition;
    this.explicitDefaultModel = options?.defaultModel;
    this.explicitAllowedModels = options?.allowedModels;
  }

  private resolveDefaultModel(): TResult<string, IDagError> {
    const defaultModelValue = this.explicitDefaultModel ?? this.definition?.defaults?.model;
    if (typeof defaultModelValue !== 'string' || defaultModelValue.trim().length === 0) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_TEXT_TO_IMAGE_MODEL_REQUIRED',
          'DAG_TEXT_TO_IMAGE_DEFAULT_MODEL must be configured or model must be specified in node config',
        ),
      };
    }
    return { ok: true, value: defaultModelValue.trim() };
  }

  private resolveAllowedModels(): readonly string[] {
    return this.explicitAllowedModels ?? this.definition?.defaults?.allowedModels ?? [];
  }

  private resolveProvider(allowedModels: readonly string[]): IImageGenerationProvider | undefined {
    if (this.definition === undefined) return undefined;
    return createImageProviderFromDefinition(this.definition, {
      imageCapableModels: allowedModels,
    });
  }

  private getImageProviderCapability(
    provider: IImageGenerationProvider | undefined,
  ): TResult<IImageGenerationProvider, IDagError> {
    if (!provider || typeof provider.generateImage !== 'function') {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_TEXT_TO_IMAGE_API_KEY_REQUIRED',
          'GEMINI_API_KEY must be configured for text-to-image node runtime',
        ),
      };
    }
    return { ok: true, value: provider };
  }

  private getFirstOutputOrError(
    result: IImageGenerationResult,
    model: string,
  ): TResult<NonNullable<IImageGenerationResult['outputs'][number]>, IDagError> {
    const firstOutput = result.outputs[0];
    if (!firstOutput) {
      return {
        ok: false,
        error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_TEXT_TO_IMAGE_RESPONSE_MISSING_IMAGE',
          'Text-to-image response did not include image data',
          false,
          { model },
        ),
      };
    }
    return { ok: true, value: firstOutput };
  }

  public async generateImage(
    request: ITextToImageRequest,
  ): Promise<TResult<IPortBinaryValue, IDagError>> {
    const defaultModelResult = this.resolveDefaultModel();
    if (!defaultModelResult.ok) return defaultModelResult;
    const allowedModels = this.resolveAllowedModels();
    const resolvedProvider = this.resolveProvider(allowedModels);
    const providerCapabilityResult = this.getImageProviderCapability(resolvedProvider);
    if (!providerCapabilityResult.ok) {
      return providerCapabilityResult;
    }
    const provider = providerCapabilityResult.value;
    const modelResult = resolveModel(request.model, defaultModelResult.value, allowedModels);
    if (!modelResult.ok) {
      return modelResult;
    }

    const result = await provider.generateImage({
      prompt: request.prompt,
      model: modelResult.value,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_TEXT_TO_IMAGE_FAILED',
          result.error.message,
          false,
          { code: result.error.code, model: modelResult.value },
        ),
      };
    }

    const outputResult = this.getFirstOutputOrError(result.value, modelResult.value);
    if (!outputResult.ok) {
      return outputResult;
    }
    return normalizeImageOutput(outputResult.value);
  }
}
