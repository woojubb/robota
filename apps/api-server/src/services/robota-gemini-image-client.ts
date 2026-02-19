import { GoogleProvider } from '@robota-sdk/google';
import {
    buildTaskExecutionError,
    buildValidationError,
    type IDagError,
    type IPortBinaryValue,
    type TResult
} from '@robota-sdk/dag-core';
import type { IImageGenerationProvider, IMediaOutputRef } from '@robota-sdk/agents';
import type {
    IGeminiImageClient,
    IGeminiImageComposeRequest,
    IGeminiImageEditRequest
} from '@robota-sdk/dag-node-gemini-image-edit';
import { LocalFsAssetStore } from './local-fs-asset-store.js';

const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image-preview';

interface IRobotaGeminiImageClientOptions {
    apiKey?: string;
    assetStore: LocalFsAssetStore;
    defaultModel: string;
    allowedModels: string[];
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

async function readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        if (Buffer.isBuffer(chunk)) {
            chunks.push(chunk);
            continue;
        }
        if (typeof chunk === 'string') {
            chunks.push(Buffer.from(chunk));
            continue;
        }
        chunks.push(Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
}

async function readAssetAsInlineImagePart(
    assetStore: LocalFsAssetStore,
    assetId: string,
    notFoundCode: string,
    notFoundDetail: string
): Promise<TResult<{ type: 'image_inline'; data: string; mimeType: string }, IDagError>> {
    const content = await assetStore.getContent(assetId);
    if (!content) {
        return {
            ok: false,
            error: buildValidationError(
                notFoundCode,
                notFoundDetail,
                { assetId }
            )
        };
    }
    const inputBuffer = await readStreamToBuffer(content.stream);
    return {
        ok: true,
        value: {
            type: 'image_inline',
            data: inputBuffer.toString('base64'),
            mimeType: content.metadata.mediaType
        }
    };
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

async function resolveProviderOutputToPortBinaryValue(
    output: IMediaOutputRef,
    assetStore: LocalFsAssetStore,
    fileNamePrefix: string
): Promise<TResult<IPortBinaryValue, IDagError>> {
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
        const resolvedMimeType = typeof output.mimeType === 'string' && output.mimeType.trim().length > 0
            ? output.mimeType
            : 'application/octet-stream';
        return {
            ok: true,
            value: {
                kind: 'image',
                mimeType: resolvedMimeType,
                uri: `asset://${output.assetId}`,
                referenceType: 'asset',
                assetId: output.assetId,
                sizeBytes: output.bytes
            }
        };
    }
    if (typeof output.uri !== 'string') {
        return {
            ok: false,
            error: buildTaskExecutionError(
                'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_URI_MISSING',
                'Provider returned uri output without uri value',
                false
            )
        };
    }
    const parsedDataUri = parseDataUri(output.uri);
    if (!parsedDataUri) {
        return {
            ok: false,
            error: buildTaskExecutionError(
                'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_URI_UNSUPPORTED',
                'Provider uri output must be a base64 data URI in API server Gemini runtime',
                false,
                { uri: output.uri.slice(0, 64) }
            )
        };
    }
    const outputBuffer = Buffer.from(parsedDataUri.data, 'base64');
    const metadata = await assetStore.save({
        fileName: `${fileNamePrefix}-${Date.now()}.bin`,
        mediaType: parsedDataUri.mimeType,
        content: outputBuffer
    });
    return {
        ok: true,
        value: {
            kind: 'image',
            mimeType: metadata.mediaType,
            uri: `asset://${metadata.assetId}`,
            referenceType: 'asset',
            assetId: metadata.assetId,
            sizeBytes: metadata.sizeBytes
        }
    };
}

export class RobotaGeminiImageClient implements IGeminiImageClient {
    private readonly provider?: IImageGenerationProvider;
    private readonly assetStore: LocalFsAssetStore;
    private readonly defaultModel: string;
    private readonly allowedModels: string[];

    public constructor(options: IRobotaGeminiImageClientOptions) {
        if (typeof options.apiKey === 'string' && options.apiKey.trim().length > 0) {
            this.provider = new GoogleProvider({
                apiKey: options.apiKey,
                imageCapableModels: options.allowedModels
            });
        }
        this.assetStore = options.assetStore;
        this.defaultModel = options.defaultModel;
        this.allowedModels = options.allowedModels;
    }

    public async editImage(request: IGeminiImageEditRequest): Promise<TResult<IPortBinaryValue, IDagError>> {
        if (!this.provider) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_API_KEY_REQUIRED',
                    'GEMINI_API_KEY must be configured for Gemini image node runtime'
                )
            };
        }
        if (typeof this.provider.editImage !== 'function') {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_GEMINI_IMAGE_EDIT_UNSUPPORTED',
                    'Configured image provider does not support editImage operation',
                    false
                )
            };
        }
        const selectedModel = request.model.trim().length > 0 ? request.model : this.defaultModel;
        if (this.allowedModels.length > 0 && !this.allowedModels.includes(selectedModel)) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_MODEL_NOT_ALLOWED',
                    'Selected Gemini image model is not allowed in DAG runtime',
                    { model: selectedModel }
                )
            };
        }

        const inputPartResult = await readAssetAsInlineImagePart(
            this.assetStore,
            request.inputAssetId,
            'DAG_VALIDATION_GEMINI_IMAGE_INPUT_ASSET_NOT_FOUND',
            'Input image asset was not found or is not binary content'
        );
        if (!inputPartResult.ok) {
            return inputPartResult;
        }

        try {
            const imageEditResult = await this.provider.editImage({
                image: {
                    kind: 'inline',
                    mimeType: inputPartResult.value.mimeType,
                    data: inputPartResult.value.data
                },
                prompt: request.prompt,
                model: selectedModel
            });
            if (!imageEditResult.ok) {
                return {
                    ok: false,
                    error: buildTaskExecutionError(
                        'DAG_TASK_EXECUTION_GEMINI_IMAGE_EDIT_FAILED',
                        imageEditResult.error.message,
                        false,
                        { code: imageEditResult.error.code, model: selectedModel }
                    )
                };
            }
            const firstOutput = imageEditResult.value.outputs[0];
            if (!firstOutput) {
                return {
                    ok: false,
                    error: buildTaskExecutionError(
                        'DAG_TASK_EXECUTION_GEMINI_IMAGE_RESPONSE_MISSING_IMAGE',
                        'Gemini image response did not include image data',
                        false,
                        { model: selectedModel }
                    )
                };
            }
            return resolveProviderOutputToPortBinaryValue(firstOutput, this.assetStore, 'gemini-image');
        } catch (error) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_GEMINI_IMAGE_EDIT_FAILED',
                    error instanceof Error ? error.message : 'Gemini image edit failed',
                    true,
                    { model: selectedModel }
                )
            };
        }
    }

    public async composeImages(request: IGeminiImageComposeRequest): Promise<TResult<IPortBinaryValue, IDagError>> {
        if (!this.provider) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_API_KEY_REQUIRED',
                    'GEMINI_API_KEY must be configured for Gemini image node runtime'
                )
            };
        }
        if (typeof this.provider.composeImage !== 'function') {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_GEMINI_IMAGE_COMPOSE_UNSUPPORTED',
                    'Configured image provider does not support composeImage operation',
                    false
                )
            };
        }
        const selectedModel = request.model.trim().length > 0 ? request.model : this.defaultModel;
        if (this.allowedModels.length > 0 && !this.allowedModels.includes(selectedModel)) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_MODEL_NOT_ALLOWED',
                    'Selected Gemini image model is not allowed in DAG runtime',
                    { model: selectedModel }
                )
            };
        }
        if (!Array.isArray(request.inputAssetIds) || request.inputAssetIds.length < 2) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_IMAGES_MIN_ITEMS',
                    'Gemini image compose requires at least two input asset ids'
                )
            };
        }
        const composeImages: Array<{ kind: 'inline'; mimeType: string; data: string }> = [];
        for (const [index, inputAssetId] of request.inputAssetIds.entries()) {
            const inputPartResult = await readAssetAsInlineImagePart(
                this.assetStore,
                inputAssetId,
                'DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_IMAGE_ASSET_NOT_FOUND',
                'Compose image asset was not found or is not binary content'
            );
            if (!inputPartResult.ok) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_IMAGE_ASSET_NOT_FOUND',
                        'Compose image asset was not found or is not binary content',
                        { index, assetId: inputAssetId }
                    )
                };
            }
            composeImages.push({
                kind: 'inline',
                mimeType: inputPartResult.value.mimeType,
                data: inputPartResult.value.data
            });
        }

        try {
            const composeResult = await this.provider.composeImage({
                images: composeImages,
                prompt: request.prompt,
                model: selectedModel
            });
            if (!composeResult.ok) {
                return {
                    ok: false,
                    error: buildTaskExecutionError(
                        'DAG_TASK_EXECUTION_GEMINI_IMAGE_COMPOSE_FAILED',
                        composeResult.error.message,
                        false,
                        { code: composeResult.error.code, model: selectedModel }
                    )
                };
            }
            const firstOutput = composeResult.value.outputs[0];
            if (!firstOutput) {
                return {
                    ok: false,
                    error: buildTaskExecutionError(
                        'DAG_TASK_EXECUTION_GEMINI_IMAGE_RESPONSE_MISSING_IMAGE',
                        'Gemini image response did not include image data',
                        false,
                        { model: selectedModel }
                    )
                };
            }
            return resolveProviderOutputToPortBinaryValue(firstOutput, this.assetStore, 'gemini-image-compose');
        } catch (error) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_GEMINI_IMAGE_COMPOSE_FAILED',
                    error instanceof Error ? error.message : 'Gemini image compose failed',
                    true,
                    { model: selectedModel }
                )
            };
        }
    }
}

export function createRobotaGeminiImageClientFromEnv(assetStore: LocalFsAssetStore): RobotaGeminiImageClient {
    const apiKey = process.env.GEMINI_API_KEY;
    const defaultModelRaw = process.env.DAG_GEMINI_IMAGE_DEFAULT_MODEL;
    const defaultModel = typeof defaultModelRaw === 'string' && defaultModelRaw.trim().length > 0
        ? defaultModelRaw.trim()
        : DEFAULT_GEMINI_IMAGE_MODEL;
    const allowedModels = parseCsv(process.env.DAG_GEMINI_IMAGE_ALLOWED_MODELS);
    const resolvedAllowedModels = allowedModels.length > 0
        ? allowedModels
        : [defaultModel];

    return new RobotaGeminiImageClient({
        apiKey: typeof apiKey === 'string' ? apiKey.trim() : undefined,
        assetStore,
        defaultModel,
        allowedModels: resolvedAllowedModels
    });
}
