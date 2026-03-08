import {
    AbstractNodeDefinition,
    BINARY_PORT_PRESETS,
    NodeIoAccessor,
    buildTaskExecutionError,
    buildValidationError,
    createBinaryPortDefinition,
    type ICostEstimate,
    type IDagError,
    type IDagNodeDefinition,
    type INodeExecutionContext,
    type TResult,
    type TPortPayload
} from '@robota-sdk/dag-core';
import { z } from 'zod';
import {
    GeminiImageRuntime,
    isImageBinaryValue,
    type IGeminiImageRuntimeOptions
} from './runtime-core.js';

export type {
    IGeminiImageEditRequest,
    IGeminiImageComposeRequest,
    IGeminiImageRuntimeOptions
} from './runtime-core.js';

/** Options for constructing a {@link GeminiImageEditNodeDefinition}. */
export interface IGeminiImageEditNodeDefinitionOptions extends IGeminiImageRuntimeOptions {}
/** Options for constructing a {@link GeminiImageComposeNodeDefinition}. */
export interface IGeminiImageComposeNodeDefinitionOptions extends IGeminiImageRuntimeOptions {}

const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const DEFAULT_IMAGE_EDIT_COST_USD = 0.01;
const DEFAULT_IMAGE_COMPOSE_COST_USD = 0.015;

const GeminiImageEditConfigSchema = z.object({
    model: z.string().default(DEFAULT_GEMINI_IMAGE_MODEL),
    baseCostUsd: z.number().default(DEFAULT_IMAGE_EDIT_COST_USD)
});

const GeminiImageComposeConfigSchema = z.object({
    model: z.string().default(DEFAULT_GEMINI_IMAGE_MODEL),
    baseCostUsd: z.number().default(DEFAULT_IMAGE_COMPOSE_COST_USD)
});

/**
 * DAG node that edits a single image using the Gemini image generation API.
 *
 * Accepts a binary image and a text prompt, then returns the edited image.
 *
 * @extends AbstractNodeDefinition
 */
export class GeminiImageEditNodeDefinition extends AbstractNodeDefinition<typeof GeminiImageEditConfigSchema> {
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
        }),
        { key: 'prompt', label: 'Prompt', order: 1, type: 'string', required: true }
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
    public readonly configSchemaDefinition = GeminiImageEditConfigSchema;

    private readonly runtime: GeminiImageRuntime;

    public constructor(options?: IGeminiImageEditNodeDefinitionOptions) {
        super();
        this.runtime = new GeminiImageRuntime(options);
    }

    public override async estimateCostWithConfig(
        _input: TPortPayload,
        _context: INodeExecutionContext,
        config: z.output<typeof GeminiImageEditConfigSchema>
    ): Promise<TResult<ICostEstimate, IDagError>> {
        return { ok: true, value: { estimatedCostUsd: config.baseCostUsd } };
    }

    protected override async executeWithConfig(
        input: TPortPayload,
        context: INodeExecutionContext,
        config: z.output<typeof GeminiImageEditConfigSchema>
    ): Promise<TResult<TPortPayload, IDagError>> {
        const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
        const imageInputResult = io.requireInputBinary('image', 'image');
        if (!imageInputResult.ok || !isImageBinaryValue(imageInputResult.value)) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_INPUT_INVALID',
                    'Gemini image node input image must be binary image payload',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const promptInputResult = io.requireInputString('prompt');
        if (!promptInputResult.ok || promptInputResult.value.trim().length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_PROMPT_REQUIRED',
                    'Gemini image node requires non-empty input prompt',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const imageEditResult = await this.runtime.editImage({
            image: imageInputResult.value,
            prompt: promptInputResult.value.trim(),
            model: config.model
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

/**
 * DAG node that composes multiple images into one using the Gemini image generation API.
 *
 * Accepts a list of binary images (minimum two) and a text prompt, then returns the composed image.
 *
 * @extends AbstractNodeDefinition
 */
export class GeminiImageComposeNodeDefinition extends AbstractNodeDefinition<typeof GeminiImageComposeConfigSchema> {
    public readonly nodeType = 'gemini-image-compose';
    public readonly displayName = 'Gemini Image Compose';
    public readonly category = 'AI';
    public readonly inputs: IDagNodeDefinition['inputs'] = [
        createBinaryPortDefinition({
            key: 'images',
            label: 'Images',
            order: 0,
            required: true,
            preset: BINARY_PORT_PRESETS.IMAGE_COMMON,
            isList: true,
            minItems: 2
        }),
        { key: 'prompt', label: 'Prompt', order: 1, type: 'string', required: true }
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
    public readonly configSchemaDefinition = GeminiImageComposeConfigSchema;

    private readonly runtime: GeminiImageRuntime;

    public constructor(options?: IGeminiImageComposeNodeDefinitionOptions) {
        super();
        this.runtime = new GeminiImageRuntime(options);
    }

    public override async estimateCostWithConfig(
        _input: TPortPayload,
        _context: INodeExecutionContext,
        config: z.output<typeof GeminiImageComposeConfigSchema>
    ): Promise<TResult<ICostEstimate, IDagError>> {
        return { ok: true, value: { estimatedCostUsd: config.baseCostUsd } };
    }

    protected override async executeWithConfig(
        input: TPortPayload,
        context: INodeExecutionContext,
        config: z.output<typeof GeminiImageComposeConfigSchema>
    ): Promise<TResult<TPortPayload, IDagError>> {
        const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
        const imagesInputResult = io.requireInputBinaryList('images', 'image', { minItems: 2 });
        if (!imagesInputResult.ok) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_IMAGES_INVALID',
                    'Gemini image compose node input images must be binary image payload array with at least two items',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const promptInputResult = io.requireInputString('prompt');
        if (!promptInputResult.ok || promptInputResult.value.trim().length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_PROMPT_REQUIRED',
                    'Gemini image compose node requires non-empty input prompt',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const composedImageResult = await this.runtime.composeImages({
            images: imagesInputResult.value,
            prompt: promptInputResult.value.trim(),
            model: config.model
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

