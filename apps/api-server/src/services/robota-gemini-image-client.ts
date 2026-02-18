import { GoogleProvider } from '@robota-sdk/google';
import {
    buildTaskExecutionError,
    buildValidationError,
    type IDagError,
    type IPortBinaryValue,
    type TResult
} from '@robota-sdk/dag-core';
import type { TUniversalMessage } from '@robota-sdk/agents';
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

function resolveImageInlinePart(message: TUniversalMessage): { data: string; mimeType: string } | undefined {
    const parts = message.parts ?? [];
    for (const part of parts) {
        if (part.type === 'image_inline') {
            return {
                data: part.data,
                mimeType: part.mimeType
            };
        }
    }
    return undefined;
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

export class RobotaGeminiImageClient implements IGeminiImageClient {
    private readonly provider?: GoogleProvider;
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

        const userMessage: TUniversalMessage = {
            role: 'user',
            content: request.prompt,
            parts: [
                inputPartResult.value,
                {
                    type: 'text',
                    text: request.prompt
                }
            ],
            timestamp: new Date()
        };

        try {
            const responseMessage = await this.provider.chat([userMessage], {
                model: selectedModel,
                google: {
                    responseModalities: ['TEXT', 'IMAGE']
                }
            });
            const generatedImagePart = resolveImageInlinePart(responseMessage);
            if (!generatedImagePart) {
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

            const outputBuffer = Buffer.from(generatedImagePart.data, 'base64');
            const metadata = await this.assetStore.save({
                fileName: `gemini-image-${Date.now()}.bin`,
                mediaType: generatedImagePart.mimeType,
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

        const firstInputPartResult = await readAssetAsInlineImagePart(
            this.assetStore,
            request.firstInputAssetId,
            'DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_IMAGE_A_ASSET_NOT_FOUND',
            'Image A asset was not found or is not binary content'
        );
        if (!firstInputPartResult.ok) {
            return firstInputPartResult;
        }
        const secondInputPartResult = await readAssetAsInlineImagePart(
            this.assetStore,
            request.secondInputAssetId,
            'DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_IMAGE_B_ASSET_NOT_FOUND',
            'Image B asset was not found or is not binary content'
        );
        if (!secondInputPartResult.ok) {
            return secondInputPartResult;
        }

        const userMessage: TUniversalMessage = {
            role: 'user',
            content: request.prompt,
            parts: [
                firstInputPartResult.value,
                secondInputPartResult.value,
                {
                    type: 'text',
                    text: request.prompt
                }
            ],
            timestamp: new Date()
        };

        try {
            const responseMessage = await this.provider.chat([userMessage], {
                model: selectedModel,
                google: {
                    responseModalities: ['TEXT', 'IMAGE']
                }
            });
            const generatedImagePart = resolveImageInlinePart(responseMessage);
            if (!generatedImagePart) {
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
            const outputBuffer = Buffer.from(generatedImagePart.data, 'base64');
            const metadata = await this.assetStore.save({
                fileName: `gemini-image-compose-${Date.now()}.bin`,
                mediaType: generatedImagePart.mimeType,
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
