import {
    AbstractNodeDefinition,
    BINARY_PORT_PRESETS,
    NodeIoAccessor,
    createBinaryPortDefinition
} from '@robota-sdk/dag-node';
import {
    buildTaskExecutionError,
    buildValidationError,
    type ICostEstimate,
    type IDagError,
    type IDagNodeDefinition,
    type INodeExecutionContext,
    type IPortBinaryValue,
    type TResult,
    type TPortPayload
} from '@robota-sdk/dag-core';
import { z } from 'zod';
import { SeedanceVideoRuntime, type ISeedanceVideoRuntimeOptions } from './runtime.js';

export type {
    ISeedanceGenerateVideoRequest,
    ISeedanceVideoRuntimeOptions
} from './runtime.js';

/** Options for constructing a {@link SeedanceVideoNodeDefinition}. */
export interface ISeedanceVideoNodeDefinitionOptions extends ISeedanceVideoRuntimeOptions {}

const DEFAULT_SEEDANCE_MODEL = 'seedance-1-5-pro-251215';
const DEFAULT_BASE_COST_USD = 0.08;
const IMAGE_INPUT_SURCHARGE_USD = 0.02;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_POLL_TIMEOUT_MS = 180_000;

const SeedanceVideoConfigSchema = z.object({
    model: z.string().default(DEFAULT_SEEDANCE_MODEL),
    durationSeconds: z.number().positive().optional(),
    aspectRatio: z.string().optional(),
    seed: z.number().int().optional(),
    pollIntervalMs: z.number().int().positive().default(DEFAULT_POLL_INTERVAL_MS),
    pollTimeoutMs: z.number().int().positive().default(DEFAULT_POLL_TIMEOUT_MS),
    baseCredits: z.number().default(DEFAULT_BASE_COST_USD)
});

class SeedanceVideoNodeTaskHandler {
    private readonly runtime: SeedanceVideoRuntime;

    public constructor(options?: ISeedanceVideoNodeDefinitionOptions) {
        this.runtime = new SeedanceVideoRuntime(options);
    }

    public async estimateCost(
        input: TPortPayload,
        _context: INodeExecutionContext,
        config: z.output<typeof SeedanceVideoConfigSchema>
    ): Promise<TResult<ICostEstimate, IDagError>> {
        const imagesInput = input.images;
        const imageSurcharge = Array.isArray(imagesInput) && imagesInput.length > 0 ? IMAGE_INPUT_SURCHARGE_USD : 0;
        const estimatedCredits = config.baseCredits + imageSurcharge;
        return {
            ok: true,
            value: { estimatedCredits }
        };
    }

    public async execute(
        input: TPortPayload,
        context: INodeExecutionContext,
        config: z.output<typeof SeedanceVideoConfigSchema>
    ): Promise<TResult<TPortPayload, IDagError>> {
        const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
        const promptInputResult = io.requireInputString('prompt');
        if (!promptInputResult.ok) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_SEEDANCE_PROMPT_REQUIRED',
                    'Seedance node requires non-empty input prompt',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }

        const promptValue = promptInputResult.value.trim();
        if (promptValue.length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_SEEDANCE_PROMPT_REQUIRED',
                    'Seedance node requires non-empty input prompt',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }

        const imagesInputValue = io.getInput('images');
        let resolvedImages: IPortBinaryValue[] | undefined;
        if (typeof imagesInputValue !== 'undefined') {
            const parsedImagesResult = io.requireInputBinaryList('images', 'image', { minItems: 1 });
            if (!parsedImagesResult.ok) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_SEEDANCE_IMAGES_INVALID',
                        'Seedance node input images must be binary image payload array',
                        { nodeId: context.nodeDefinition.nodeId }
                    )
                };
            }
            resolvedImages = parsedImagesResult.value;
        }

        const resolvedModel = typeof config.model === 'string' && config.model.trim().length > 0
            ? config.model
            : DEFAULT_SEEDANCE_MODEL;

        const videoResult = await this.runtime.generateVideo({
            prompt: promptValue,
            model: resolvedModel,
            inputImages: resolvedImages,
            durationSeconds: config.durationSeconds,
            aspectRatio: typeof config.aspectRatio === 'string' && config.aspectRatio.trim().length > 0
                ? config.aspectRatio.trim()
                : undefined,
            seed: config.seed,
            pollIntervalMs: config.pollIntervalMs,
            pollTimeoutMs: config.pollTimeoutMs
        });
        if (!videoResult.ok) {
            return videoResult;
        }
        if (videoResult.value.kind !== 'video') {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_SEEDANCE_OUTPUT_INVALID',
                    'Seedance node returned non-video output',
                    false
                )
            };
        }

        io.setOutput('video', videoResult.value);
        return {
            ok: true,
            value: io.toOutput()
        };
    }
}

/**
 * DAG node that generates video using the Seedance (Bytedance) video generation API.
 *
 * Accepts a text prompt and optional reference images, then produces a video output
 * by polling the Seedance job until completion or timeout.
 *
 * @extends AbstractNodeDefinition
 */
export class SeedanceVideoNodeDefinition extends AbstractNodeDefinition<typeof SeedanceVideoConfigSchema> {
    public readonly nodeType = 'seedance-video';
    public readonly displayName = 'Seedance Video';
    public readonly category = 'AI';
    public readonly inputs: IDagNodeDefinition['inputs'] = [
        { key: 'prompt', label: 'Prompt', order: 0, type: 'string', required: true },
        createBinaryPortDefinition({
            key: 'images',
            label: 'Images',
            order: 1,
            required: false,
            preset: BINARY_PORT_PRESETS.IMAGE_COMMON,
            isList: true,
            minItems: 1
        })
    ];
    public readonly outputs: IDagNodeDefinition['outputs'] = [
        createBinaryPortDefinition({
            key: 'video',
            label: 'Video',
            order: 0,
            required: true,
            preset: BINARY_PORT_PRESETS.VIDEO_MP4
        })
    ];
    public readonly configSchemaDefinition = SeedanceVideoConfigSchema;
    private readonly taskExecutor: SeedanceVideoNodeTaskHandler;

    public constructor(options?: ISeedanceVideoNodeDefinitionOptions) {
        super();
        this.taskExecutor = new SeedanceVideoNodeTaskHandler(options);
    }

    public override async estimateCostWithConfig(
        input: TPortPayload,
        context: INodeExecutionContext,
        config: z.output<typeof SeedanceVideoConfigSchema>
    ): Promise<TResult<ICostEstimate, IDagError>> {
        return this.taskExecutor.estimateCost(input, context, config);
    }

    protected override async executeWithConfig(
        input: TPortPayload,
        context: INodeExecutionContext,
        config: z.output<typeof SeedanceVideoConfigSchema>
    ): Promise<TResult<TPortPayload, IDagError>> {
        return this.taskExecutor.execute(input, context, config);
    }
}
