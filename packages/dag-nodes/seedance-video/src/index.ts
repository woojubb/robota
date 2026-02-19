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

export interface ISeedanceVideoRequest {
    prompt: string;
    model: string;
    inputImages?: IPortBinaryValue[];
    durationSeconds?: number;
    aspectRatio?: string;
    seed?: number;
    pollIntervalMs: number;
    pollTimeoutMs: number;
}

export interface ISeedanceVideoClient {
    generateVideo(request: ISeedanceVideoRequest): Promise<TResult<IPortBinaryValue, IDagError>>;
}

export interface ISeedanceVideoNodeDefinitionOptions {
    videoClient: ISeedanceVideoClient;
}

const DEFAULT_SEEDANCE_MODEL = 'seedance-1-5-pro-251215';
const DEFAULT_BASE_COST_USD = 0.08;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_POLL_TIMEOUT_MS = 180_000;

function isImageBinaryValue(value: TPortPayload[string] | undefined): value is IPortBinaryValue {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    return (
        'kind' in value
        && value.kind === 'image'
        && 'mimeType' in value
        && typeof value.mimeType === 'string'
        && 'uri' in value
        && typeof value.uri === 'string'
    );
}

class SeedanceVideoNodeTaskHandler {
    private readonly videoClient: ISeedanceVideoClient;

    public constructor(videoClient: ISeedanceVideoClient) {
        this.videoClient = videoClient;
    }

    public async estimateCost(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<ICostEstimate, IDagError>> {
        const baseCostValue = context.nodeDefinition.config.baseCostUsd;
        if (typeof baseCostValue !== 'undefined' && typeof baseCostValue !== 'number') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_SEEDANCE_BASE_COST_INVALID',
                    'baseCostUsd must be a number when configured',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const imagesInput = input.images;
        const imageSurcharge = Array.isArray(imagesInput) && imagesInput.length > 0 ? 0.02 : 0;
        const estimatedCostUsd = (typeof baseCostValue === 'number' ? baseCostValue : DEFAULT_BASE_COST_USD) + imageSurcharge;
        return {
            ok: true,
            value: { estimatedCostUsd }
        };
    }

    public async execute(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<TPortPayload, IDagError>> {
        const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
        const promptInputResult = io.requireInput('prompt');
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
        if (typeof promptInputResult.value !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_SEEDANCE_PROMPT_REQUIRED',
                    'Seedance node input prompt must be string',
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
            if (!Array.isArray(imagesInputValue)) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_SEEDANCE_IMAGES_INVALID',
                        'Seedance node input images must be binary image payload array',
                        { nodeId: context.nodeDefinition.nodeId }
                    )
                };
            }
            const parsedImages: IPortBinaryValue[] = [];
            for (const [index, imageValue] of imagesInputValue.entries()) {
                if (!isImageBinaryValue(imageValue)) {
                    return {
                        ok: false,
                        error: buildValidationError(
                            'DAG_VALIDATION_SEEDANCE_IMAGES_INVALID',
                            'Seedance node input images must be binary image payload array',
                            { nodeId: context.nodeDefinition.nodeId, index }
                        )
                    };
                }
                parsedImages.push(imageValue);
            }
            if (parsedImages.length === 0) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_SEEDANCE_IMAGES_INVALID',
                        'Seedance node input images must include at least one item when provided',
                        { nodeId: context.nodeDefinition.nodeId }
                    )
                };
            }
            resolvedImages = parsedImages;
        }

        const modelValue = context.nodeDefinition.config.model;
        if (typeof modelValue !== 'undefined' && typeof modelValue !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_SEEDANCE_MODEL_INVALID',
                    'Seedance node config model must be string when configured',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const resolvedModel = typeof modelValue === 'string' && modelValue.trim().length > 0
            ? modelValue
            : DEFAULT_SEEDANCE_MODEL;

        const durationSeconds = context.nodeDefinition.config.durationSeconds;
        if (typeof durationSeconds !== 'undefined' && typeof durationSeconds !== 'number') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_SEEDANCE_DURATION_INVALID',
                    'durationSeconds must be a number when configured',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const aspectRatio = context.nodeDefinition.config.aspectRatio;
        if (typeof aspectRatio !== 'undefined' && typeof aspectRatio !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_SEEDANCE_ASPECT_RATIO_INVALID',
                    'aspectRatio must be a string when configured',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const seed = context.nodeDefinition.config.seed;
        if (typeof seed !== 'undefined' && typeof seed !== 'number') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_SEEDANCE_SEED_INVALID',
                    'seed must be a number when configured',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const pollIntervalMs = context.nodeDefinition.config.pollIntervalMs;
        if (typeof pollIntervalMs !== 'undefined' && typeof pollIntervalMs !== 'number') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_SEEDANCE_POLL_INTERVAL_INVALID',
                    'pollIntervalMs must be a number when configured',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }
        const pollTimeoutMs = context.nodeDefinition.config.pollTimeoutMs;
        if (typeof pollTimeoutMs !== 'undefined' && typeof pollTimeoutMs !== 'number') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_SEEDANCE_POLL_TIMEOUT_INVALID',
                    'pollTimeoutMs must be a number when configured',
                    { nodeId: context.nodeDefinition.nodeId }
                )
            };
        }

        const videoResult = await this.videoClient.generateVideo({
            prompt: promptValue,
            model: resolvedModel,
            inputImages: resolvedImages,
            durationSeconds: typeof durationSeconds === 'number' ? durationSeconds : undefined,
            aspectRatio: typeof aspectRatio === 'string' && aspectRatio.trim().length > 0 ? aspectRatio.trim() : undefined,
            seed: typeof seed === 'number' ? seed : undefined,
            pollIntervalMs: typeof pollIntervalMs === 'number' ? pollIntervalMs : DEFAULT_POLL_INTERVAL_MS,
            pollTimeoutMs: typeof pollTimeoutMs === 'number' ? pollTimeoutMs : DEFAULT_POLL_TIMEOUT_MS
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

export class SeedanceVideoNodeDefinition implements IDagNodeDefinition {
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
    public readonly configSchemaDefinition = z.object({
        model: z.string().default(DEFAULT_SEEDANCE_MODEL),
        durationSeconds: z.number().positive().optional(),
        aspectRatio: z.string().optional(),
        seed: z.number().int().optional(),
        pollIntervalMs: z.number().int().positive().default(DEFAULT_POLL_INTERVAL_MS),
        pollTimeoutMs: z.number().int().positive().default(DEFAULT_POLL_TIMEOUT_MS),
        baseCostUsd: z.number().default(DEFAULT_BASE_COST_USD)
    });
    public readonly taskHandler: SeedanceVideoNodeTaskHandler;

    public constructor(options: ISeedanceVideoNodeDefinitionOptions) {
        this.taskHandler = new SeedanceVideoNodeTaskHandler(options.videoClient);
    }
}
