import {
    buildTaskExecutionError,
    buildValidationError,
    type IDagError,
    type IPortBinaryValue,
    type TResult
} from '@robota-sdk/dag-core';
import { GoogleProvider } from '@robota-sdk/google';
import type { IImageGenerationProvider, IMediaOutputRef } from '@robota-sdk/agents';

const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const DEFAULT_DAG_DEV_PORT = 3011;

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

function parseCsv(value: string | undefined): string[] {
    if (typeof value !== 'string') {
        return [];
    }
    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function parseDataUri(uri: string): { mimeType: string; data: string } | undefined {
    const commaIndex = uri.indexOf(',');
    if (commaIndex < 0) {
        return undefined;
    }
    const header = uri.slice(0, commaIndex);
    const payload = uri.slice(commaIndex + 1);
    if (!header.startsWith('data:') || !header.endsWith(';base64')) {
        return undefined;
    }
    const mimeType = header.replace('data:', '').replace(';base64', '').trim();
    if (mimeType.length === 0 || payload.trim().length === 0) {
        return undefined;
    }
    return {
        mimeType,
        data: payload
    };
}

function resolveAssetIdFromBinaryInput(value: IPortBinaryValue): string | undefined {
    if (typeof value.assetId === 'string' && value.assetId.trim().length > 0) {
        return value.assetId;
    }
    if (!value.uri.startsWith('asset://')) {
        return undefined;
    }
    const rawAssetId = value.uri.slice('asset://'.length).trim();
    return rawAssetId.length > 0 ? rawAssetId : undefined;
}

function toAssetContentUrl(assetId: string): string {
    const runtimeBaseUrl = process.env.DAG_RUNTIME_BASE_URL?.trim();
    if (runtimeBaseUrl && runtimeBaseUrl.length > 0) {
        return `${runtimeBaseUrl.replace(/\/$/, '')}/v1/dag/assets/${assetId}/content`;
    }
    const portRaw = process.env.DAG_DEV_PORT;
    const portParsed = typeof portRaw === 'string' ? Number.parseInt(portRaw, 10) : Number.NaN;
    const port = Number.isFinite(portParsed) && portParsed > 0 ? portParsed : DEFAULT_DAG_DEV_PORT;
    return `http://127.0.0.1:${port}/v1/dag/assets/${assetId}/content`;
}

export function isImageBinaryValue(value: unknown): value is IPortBinaryValue {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    if (!('kind' in value) || value.kind !== 'image') {
        return false;
    }
    return (
        'mimeType' in value
        && typeof value.mimeType === 'string'
        && 'uri' in value
        && typeof value.uri === 'string'
    );
}

export class GeminiImageRuntime {
    private readonly provider?: IImageGenerationProvider;
    private readonly defaultModel: string;
    private readonly allowedModels: string[];

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
    }

    private resolveModel(selectedModel: string): TResult<string, IDagError> {
        const model = selectedModel.trim().length > 0 ? selectedModel.trim() : this.defaultModel;
        if (this.allowedModels.length > 0 && !this.allowedModels.includes(model)) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_MODEL_NOT_ALLOWED',
                    'Selected Gemini image model is not allowed in DAG runtime',
                    { model }
                )
            };
        }
        return {
            ok: true,
            value: model
        };
    }

    private async toInlineImageSource(
        image: IPortBinaryValue,
        notFoundCode: string,
        notFoundMessage: string
    ): Promise<TResult<{ kind: 'inline'; mimeType: string; data: string }, IDagError>> {
        const assetId = resolveAssetIdFromBinaryInput(image);
        if (assetId) {
            const response = await fetch(toAssetContentUrl(assetId));
            if (!response.ok || !response.body) {
                return {
                    ok: false,
                    error: buildValidationError(notFoundCode, notFoundMessage, { assetId })
                };
            }
            const mediaType = response.headers.get('content-type');
            if (typeof mediaType !== 'string' || !mediaType.startsWith('image/')) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_GEMINI_IMAGE_INPUT_MEDIA_TYPE_INVALID',
                        'Gemini image input asset must resolve to image media type',
                        { assetId, mediaType: mediaType ?? 'missing' }
                    )
                };
            }
            const arrayBuffer = await response.arrayBuffer();
            return {
                ok: true,
                value: {
                    kind: 'inline',
                    mimeType: mediaType,
                    data: Buffer.from(arrayBuffer).toString('base64')
                }
            };
        }
        if (image.uri.startsWith('data:')) {
            const parsedDataUri = parseDataUri(image.uri);
            if (!parsedDataUri) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_GEMINI_IMAGE_INPUT_DATA_URI_INVALID',
                        'Gemini image input data URI must be base64 encoded',
                        { uriPrefix: image.uri.slice(0, 64) }
                    )
                };
            }
            return {
                ok: true,
                value: {
                    kind: 'inline',
                    mimeType: parsedDataUri.mimeType,
                    data: parsedDataUri.data
                }
            };
        }
        if (image.uri.startsWith('http://') || image.uri.startsWith('https://')) {
            const response = await fetch(image.uri);
            if (!response.ok || !response.body) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_GEMINI_IMAGE_INPUT_URI_UNREACHABLE',
                        'Gemini image input URI must be reachable',
                        { uri: image.uri }
                    )
                };
            }
            const mediaType = response.headers.get('content-type');
            if (typeof mediaType !== 'string' || !mediaType.startsWith('image/')) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_GEMINI_IMAGE_INPUT_MEDIA_TYPE_INVALID',
                        'Gemini image input URI must resolve to image media type',
                        { uri: image.uri, mediaType: mediaType ?? 'missing' }
                    )
                };
            }
            const arrayBuffer = await response.arrayBuffer();
            return {
                ok: true,
                value: {
                    kind: 'inline',
                    mimeType: mediaType,
                    data: Buffer.from(arrayBuffer).toString('base64')
                }
            };
        }
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_GEMINI_IMAGE_INPUT_REFERENCE_UNSUPPORTED',
                'Gemini image input must be asset://, data:, http://, or https:// URI',
                { uri: image.uri }
            )
        };
    }

    private validateImageOutput(output: IMediaOutputRef): TResult<IPortBinaryValue, IDagError> {
        if (output.kind === 'asset') {
            if (typeof output.assetId !== 'string' || output.assetId.trim().length === 0) {
                return {
                    ok: false,
                    error: buildTaskExecutionError(
                        'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_ASSET_INVALID',
                        'Provider returned asset output without valid assetId',
                        false
                    )
                };
            }
            const mimeType = typeof output.mimeType === 'string' && output.mimeType.trim().length > 0
                ? output.mimeType
                : '';
            if (!mimeType.startsWith('image/')) {
                return {
                    ok: false,
                    error: buildTaskExecutionError(
                        'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_MEDIA_TYPE_INVALID',
                        'Provider returned non-image media type for Gemini output',
                        false,
                        { mimeType }
                    )
                };
            }
            return {
                ok: true,
                value: {
                    kind: 'image',
                    mimeType,
                    uri: `asset://${output.assetId}`,
                    referenceType: 'asset',
                    assetId: output.assetId,
                    sizeBytes: output.bytes
                }
            };
        }
        if (typeof output.uri !== 'string' || output.uri.trim().length === 0) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_URI_MISSING',
                    'Provider returned uri output without uri value',
                    false
                )
            };
        }
        const outputMimeType = typeof output.mimeType === 'string' && output.mimeType.trim().length > 0
            ? output.mimeType
            : '';
        if (output.uri.startsWith('data:')) {
            const parsedDataUri = parseDataUri(output.uri);
            if (!parsedDataUri || !parsedDataUri.mimeType.startsWith('image/')) {
                return {
                    ok: false,
                    error: buildTaskExecutionError(
                        'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_URI_UNSUPPORTED',
                        'Provider URI output must be image data URI',
                        false
                    )
                };
            }
            return {
                ok: true,
                value: {
                    kind: 'image',
                    mimeType: parsedDataUri.mimeType,
                    uri: output.uri,
                    referenceType: 'uri'
                }
            };
        }
        if (!outputMimeType.startsWith('image/')) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_MEDIA_TYPE_INVALID',
                    'Provider returned non-image URI output for Gemini runtime',
                    false,
                    { mimeType: outputMimeType }
                )
            };
        }
        return {
            ok: true,
            value: {
                kind: 'image',
                mimeType: outputMimeType,
                uri: output.uri,
                referenceType: 'uri',
                sizeBytes: output.bytes
            }
        };
    }

    public async editImage(request: IGeminiImageEditRequest): Promise<TResult<IPortBinaryValue, IDagError>> {
        if (!this.provider || typeof this.provider.editImage !== 'function') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_API_KEY_REQUIRED',
                    'GEMINI_API_KEY must be configured for Gemini image node runtime'
                )
            };
        }
        const modelResult = this.resolveModel(request.model);
        if (!modelResult.ok) {
            return modelResult;
        }
        const imageSourceResult = await this.toInlineImageSource(
            request.image,
            'DAG_VALIDATION_GEMINI_IMAGE_INPUT_ASSET_NOT_FOUND',
            'Input image asset was not found or is not binary content'
        );
        if (!imageSourceResult.ok) {
            return imageSourceResult;
        }
        const result = await this.provider.editImage({
            image: imageSourceResult.value,
            prompt: request.prompt,
            model: modelResult.value
        });
        if (!result.ok) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_GEMINI_IMAGE_EDIT_FAILED',
                    result.error.message,
                    false,
                    { code: result.error.code, model: modelResult.value }
                )
            };
        }
        const firstOutput = result.value.outputs[0];
        if (!firstOutput) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_GEMINI_IMAGE_RESPONSE_MISSING_IMAGE',
                    'Gemini image response did not include image data',
                    false,
                    { model: modelResult.value }
                )
            };
        }
        return this.validateImageOutput(firstOutput);
    }

    public async composeImages(request: IGeminiImageComposeRequest): Promise<TResult<IPortBinaryValue, IDagError>> {
        if (!this.provider || typeof this.provider.composeImage !== 'function') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_API_KEY_REQUIRED',
                    'GEMINI_API_KEY must be configured for Gemini image node runtime'
                )
            };
        }
        const modelResult = this.resolveModel(request.model);
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
        const composeInputs: Array<{ kind: 'inline'; mimeType: string; data: string }> = [];
        for (const [index, image] of request.images.entries()) {
            const imageSourceResult = await this.toInlineImageSource(
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
        const result = await this.provider.composeImage({
            images: composeInputs,
            prompt: request.prompt,
            model: modelResult.value
        });
        if (!result.ok) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_GEMINI_IMAGE_COMPOSE_FAILED',
                    result.error.message,
                    false,
                    { code: result.error.code, model: modelResult.value }
                )
            };
        }
        const firstOutput = result.value.outputs[0];
        if (!firstOutput) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_GEMINI_IMAGE_RESPONSE_MISSING_IMAGE',
                    'Gemini image response did not include image data',
                    false,
                    { model: modelResult.value }
                )
            };
        }
        return this.validateImageOutput(firstOutput);
    }
}

