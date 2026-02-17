import {
    BINARY_PORT_PRESETS,
    NodeIoAccessor,
    buildTaskExecutionError,
    buildValidationError,
    createBinaryPortDefinition,
    type ICostEstimate,
    type IDagError,
    type IDagNodeDefinition,
    type INodeExecutionContext,
    type IPortBinaryValue,
    type TResult,
    type TPortPayload
} from '@robota-sdk/dag-core';
import { z } from 'zod';

export interface IGeminiImageEditRequest {
    inputAssetId: string;
    prompt: string;
    model: string;
}

export interface IGeminiImageComposeRequest {
    firstInputAssetId: string;
    secondInputAssetId: string;
    prompt: string;
    model: string;
}

export interface IGeminiImageClient {
    editImage(request: IGeminiImageEditRequest): Promise<TResult<IPortBinaryValue, IDagError>>;
    composeImages(request: IGeminiImageComposeRequest): Promise<TResult<IPortBinaryValue, IDagError>>;
}

export interface IGeminiImageEditNodeDefinitionOptions {
    imageClient: IGeminiImageClient;
}

export interface IGeminiImageComposeNodeDefinitionOptions {
    imageClient: IGeminiImageClient;
}

const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

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

function isImageBinaryValue(value: unknown): value is IPortBinaryValue {
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

class GeminiImageEditNodeTaskHandler {
    private readonly imageClient: IGeminiImageClient;

    public constructor(imageClient: IGeminiImageClient) {
        this.imageClient = imageClient;
    }

    public async estimateCost(_input: TPortPayload, context: INodeExecutionContext): Promise<TResult<ICostEstimate, IDagError>> {
        const baseCostValue = context.nodeDefinition.config.baseCostUsd;
        if (typeof baseCostValue !== 'undefined' && typeof baseCostValue !== 'number') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_BASE_COST_INVALID',
                    'baseCostUsd must be a number when configured',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const estimatedCostUsd = typeof baseCostValue === 'number' ? baseCostValue : 0.01;
        return { ok: true, value: { estimatedCostUsd } };
    }

    public async execute(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<TPortPayload, IDagError>> {
        const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
        const imageInputResult = io.requireInput('image');
        if (!imageInputResult.ok) {
            return imageInputResult;
        }
        if (!isImageBinaryValue(imageInputResult.value)) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_INPUT_INVALID',
                    'Gemini image node input image must be binary image payload',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const inputAssetId = resolveAssetIdFromBinaryInput(imageInputResult.value);
        if (typeof inputAssetId === 'undefined') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_INPUT_ASSET_REQUIRED',
                    'Gemini image node requires asset:// image input reference',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }

        const promptValue = context.nodeDefinition.config.prompt;
        if (typeof promptValue !== 'string' || promptValue.trim().length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_PROMPT_REQUIRED',
                    'Gemini image node requires non-empty config prompt',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const modelValue = context.nodeDefinition.config.model;
        if (typeof modelValue !== 'undefined' && typeof modelValue !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_MODEL_INVALID',
                    'Gemini image node config model must be string when configured',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const resolvedModel = typeof modelValue === 'string' && modelValue.trim().length > 0
            ? modelValue
            : DEFAULT_GEMINI_IMAGE_MODEL;

        const imageEditResult = await this.imageClient.editImage({
            inputAssetId,
            prompt: promptValue,
            model: resolvedModel
        });
        if (!imageEditResult.ok) {
            return imageEditResult;
        }
        if (imageEditResult.value.kind !== 'image') {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_INVALID',
                    'Gemini image node returned non-image output',
                    false
                )
            };
        }

        io.setOutput('image', imageEditResult.value);
        return {
            ok: true,
            value: io.toOutput()
        };
    }
}

export class GeminiImageEditNodeDefinition implements IDagNodeDefinition {
    public readonly nodeType = 'gemini-image-edit';
    public readonly displayName = 'Gemini Image Edit';
    public readonly category = 'AI';
    public readonly inputs: IDagNodeDefinition['inputs'] = [
        createBinaryPortDefinition({
            key: 'image',
            label: 'Image',
            order: 0,
            required: true,
            preset: BINARY_PORT_PRESETS.IMAGE_COMMON
        })
    ];
    public readonly outputs: IDagNodeDefinition['outputs'] = [
        createBinaryPortDefinition({
            key: 'image',
            label: 'Image',
            order: 0,
            required: true,
            preset: BINARY_PORT_PRESETS.IMAGE_COMMON
        })
    ];
    public readonly configSchemaDefinition = z.object({
        prompt: z.string().min(1),
        model: z.string().default(DEFAULT_GEMINI_IMAGE_MODEL),
        baseCostUsd: z.number().default(0.01)
    });
    public readonly taskHandler: GeminiImageEditNodeTaskHandler;

    public constructor(options: IGeminiImageEditNodeDefinitionOptions) {
        this.taskHandler = new GeminiImageEditNodeTaskHandler(options.imageClient);
    }
}

class GeminiImageComposeNodeTaskHandler {
    private readonly imageClient: IGeminiImageClient;

    public constructor(imageClient: IGeminiImageClient) {
        this.imageClient = imageClient;
    }

    public async estimateCost(_input: TPortPayload, context: INodeExecutionContext): Promise<TResult<ICostEstimate, IDagError>> {
        const baseCostValue = context.nodeDefinition.config.baseCostUsd;
        if (typeof baseCostValue !== 'undefined' && typeof baseCostValue !== 'number') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_BASE_COST_INVALID',
                    'baseCostUsd must be a number when configured',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const estimatedCostUsd = typeof baseCostValue === 'number' ? baseCostValue : 0.015;
        return { ok: true, value: { estimatedCostUsd } };
    }

    public async execute(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<TPortPayload, IDagError>> {
        const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
        const firstImageInputResult = io.requireInput('imageA');
        if (!firstImageInputResult.ok) {
            return firstImageInputResult;
        }
        if (!isImageBinaryValue(firstImageInputResult.value)) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_IMAGE_A_INVALID',
                    'Gemini image compose node input imageA must be binary image payload',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const secondImageInputResult = io.requireInput('imageB');
        if (!secondImageInputResult.ok) {
            return secondImageInputResult;
        }
        if (!isImageBinaryValue(secondImageInputResult.value)) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_IMAGE_B_INVALID',
                    'Gemini image compose node input imageB must be binary image payload',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const firstInputAssetId = resolveAssetIdFromBinaryInput(firstImageInputResult.value);
        if (typeof firstInputAssetId === 'undefined') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_IMAGE_A_ASSET_REQUIRED',
                    'Gemini image compose node requires asset:// reference for imageA',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const secondInputAssetId = resolveAssetIdFromBinaryInput(secondImageInputResult.value);
        if (typeof secondInputAssetId === 'undefined') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_IMAGE_B_ASSET_REQUIRED',
                    'Gemini image compose node requires asset:// reference for imageB',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }

        const promptValue = context.nodeDefinition.config.prompt;
        if (typeof promptValue !== 'string' || promptValue.trim().length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_PROMPT_REQUIRED',
                    'Gemini image compose node requires non-empty config prompt',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const modelValue = context.nodeDefinition.config.model;
        if (typeof modelValue !== 'undefined' && typeof modelValue !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_MODEL_INVALID',
                    'Gemini image compose node config model must be string when configured',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const resolvedModel = typeof modelValue === 'string' && modelValue.trim().length > 0
            ? modelValue
            : DEFAULT_GEMINI_IMAGE_MODEL;

        const composedImageResult = await this.imageClient.composeImages({
            firstInputAssetId,
            secondInputAssetId,
            prompt: promptValue,
            model: resolvedModel
        });
        if (!composedImageResult.ok) {
            return composedImageResult;
        }
        if (composedImageResult.value.kind !== 'image') {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_GEMINI_IMAGE_COMPOSE_OUTPUT_INVALID',
                    'Gemini image compose node returned non-image output',
                    false
                )
            };
        }

        io.setOutput('image', composedImageResult.value);
        return {
            ok: true,
            value: io.toOutput()
        };
    }
}

export class GeminiImageComposeNodeDefinition implements IDagNodeDefinition {
    public readonly nodeType = 'gemini-image-compose';
    public readonly displayName = 'Gemini Image Compose';
    public readonly category = 'AI';
    public readonly inputs: IDagNodeDefinition['inputs'] = [
        createBinaryPortDefinition({
            key: 'imageA',
            label: 'Image A',
            order: 0,
            required: true,
            preset: BINARY_PORT_PRESETS.IMAGE_COMMON
        }),
        createBinaryPortDefinition({
            key: 'imageB',
            label: 'Image B',
            order: 1,
            required: true,
            preset: BINARY_PORT_PRESETS.IMAGE_COMMON
        })
    ];
    public readonly outputs: IDagNodeDefinition['outputs'] = [
        createBinaryPortDefinition({
            key: 'image',
            label: 'Image',
            order: 0,
            required: true,
            preset: BINARY_PORT_PRESETS.IMAGE_COMMON
        })
    ];
    public readonly configSchemaDefinition = z.object({
        prompt: z.string().min(1),
        model: z.string().default(DEFAULT_GEMINI_IMAGE_MODEL),
        baseCostUsd: z.number().default(0.015)
    });
    public readonly taskHandler: GeminiImageComposeNodeTaskHandler;

    public constructor(options: IGeminiImageComposeNodeDefinitionOptions) {
        this.taskHandler = new GeminiImageComposeNodeTaskHandler(options.imageClient);
    }
}
