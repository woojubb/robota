import {
    AbstractNodeDefinition,
    BINARY_PORT_PRESETS,
    MediaReference,
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
import { BytedanceProvider } from '@robota-sdk/bytedance';
import type {
    IVideoGenerationProvider,
    IVideoJobSnapshot,
    TImageInputSource
} from '@robota-sdk/agents';
import { z } from 'zod';

export interface ISeedanceVideoNodeDefinitionOptions {
    defaultModel?: string;
    allowedModels?: string[];
    baseUrl?: string;
    apiKey?: string;
}

const DEFAULT_SEEDANCE_MODEL = 'seedance-1-5-pro-251215';
const DEFAULT_BASE_COST_USD = 0.08;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_POLL_TIMEOUT_MS = 180_000;
const DEFAULT_DAG_DEV_PORT = 3011;

const SeedanceVideoConfigSchema = z.object({
    model: z.string().default(DEFAULT_SEEDANCE_MODEL),
    durationSeconds: z.number().positive().optional(),
    aspectRatio: z.string().optional(),
    seed: z.number().int().optional(),
    pollIntervalMs: z.number().int().positive().default(DEFAULT_POLL_INTERVAL_MS),
    pollTimeoutMs: z.number().int().positive().default(DEFAULT_POLL_TIMEOUT_MS),
    baseCostUsd: z.number().default(DEFAULT_BASE_COST_USD)
});

function parseCsv(value: string | undefined): string[] {
    if (typeof value !== 'string') {
        return [];
    }
    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function resolveRuntimeBaseUrl(): string {
    const runtimeBaseUrl = process.env.DAG_RUNTIME_BASE_URL?.trim();
    if (runtimeBaseUrl && runtimeBaseUrl.length > 0) {
        return runtimeBaseUrl.replace(/\/$/, '');
    }
    const portRaw = process.env.DAG_DEV_PORT;
    const portParsed = typeof portRaw === 'string' ? Number.parseInt(portRaw, 10) : Number.NaN;
    const port = Number.isFinite(portParsed) && portParsed > 0 ? portParsed : DEFAULT_DAG_DEV_PORT;
    return `http://127.0.0.1:${port}`;
}

function toOutputVideo(output: IVideoJobSnapshot['output']): TResult<IPortBinaryValue, IDagError> {
    if (!output) {
        return {
            ok: false,
            error: buildTaskExecutionError(
                'DAG_TASK_EXECUTION_SEEDANCE_OUTPUT_MISSING',
                'Seedance completed without output video reference',
                false
            )
        };
    }
    const mimeType = typeof output.mimeType === 'string' && output.mimeType.trim().length > 0
        ? output.mimeType
        : 'video/mp4';
    if (output.kind === 'asset') {
        if (typeof output.assetId !== 'string' || output.assetId.trim().length === 0) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_SEEDANCE_OUTPUT_ASSET_INVALID',
                    'Seedance output asset reference is missing assetId',
                    false
                )
            };
        }
        return {
            ok: true,
            value: {
                kind: 'video',
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
                'DAG_TASK_EXECUTION_SEEDANCE_OUTPUT_URI_INVALID',
                'Seedance output uri reference is missing uri',
                false
            )
        };
    }
    return {
        ok: true,
        value: {
            kind: 'video',
            mimeType,
            uri: output.uri,
            referenceType: 'uri',
            sizeBytes: output.bytes
        }
    };
}

class SeedanceVideoRuntime {
    private readonly provider?: IVideoGenerationProvider;
    private readonly defaultModel: string;
    private readonly allowedModels: string[];

    public constructor(options?: ISeedanceVideoNodeDefinitionOptions) {
        const apiKey = options?.apiKey ?? process.env.BYTEDANCE_API_KEY ?? process.env.ARK_API_KEY;
        const baseUrl = options?.baseUrl ?? process.env.BYTEDANCE_BASE_URL;
        const defaultModelRaw = options?.defaultModel ?? process.env.DAG_SEEDANCE_DEFAULT_MODEL;
        const allowedModelsRaw = options?.allowedModels ?? parseCsv(process.env.DAG_SEEDANCE_ALLOWED_MODELS);
        this.defaultModel = typeof defaultModelRaw === 'string' && defaultModelRaw.trim().length > 0
            ? defaultModelRaw.trim()
            : DEFAULT_SEEDANCE_MODEL;
        this.allowedModels = Array.isArray(allowedModelsRaw) && allowedModelsRaw.length > 0
            ? allowedModelsRaw
            : [this.defaultModel];
        if (typeof apiKey === 'string' && apiKey.trim().length > 0 && typeof baseUrl === 'string' && baseUrl.trim().length > 0) {
            this.provider = new BytedanceProvider({
                apiKey: apiKey.trim(),
                baseUrl: baseUrl.trim()
            });
        }
    }

    private async resolveImageInputSource(image: IPortBinaryValue): Promise<TResult<TImageInputSource, IDagError>> {
        const referenceResult = MediaReference.fromBinary(image);
        if (!referenceResult.ok) {
            return referenceResult;
        }
        const reference = referenceResult.value;

        if (reference.isAsset()) {
            const assetId = reference.assetId();
            if (typeof assetId !== 'string') {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_MEDIA_REFERENCE_INVALID',
                        'Asset reference must include non-empty assetId'
                    )
                };
            }
            const assetContentUrl = reference.toAssetContentUrl(resolveRuntimeBaseUrl());
            if (typeof assetContentUrl !== 'string') {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_MEDIA_REFERENCE_INVALID',
                        'Asset content URL could not be resolved',
                        { assetId }
                    )
                };
            }
            const response = await fetch(assetContentUrl);
            if (!response.ok || !response.body) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_SEEDANCE_IMAGE_ASSET_NOT_FOUND',
                        'Seedance image asset was not found',
                        { assetId }
                    )
                };
            }
            const mimeType = response.headers.get('content-type');
            if (typeof mimeType !== 'string' || !mimeType.startsWith('image/')) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_SEEDANCE_IMAGE_MEDIA_TYPE_INVALID',
                        'Seedance image asset must resolve to image media type',
                        { assetId, mimeType: mimeType ?? 'missing' }
                    )
                };
            }
            const arrayBuffer = await response.arrayBuffer();
            return {
                ok: true,
                value: {
                    kind: 'inline',
                    mimeType,
                    data: Buffer.from(arrayBuffer).toString('base64')
                }
            };
        }

        const uri = reference.uri();
        if (typeof uri !== 'string' || uri.length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_MEDIA_REFERENCE_INVALID',
                    'URI reference must include non-empty uri'
                )
            };
        }
        if (uri.startsWith('http://') || uri.startsWith('https://')) {
            return {
                ok: true,
                value: {
                    kind: 'uri',
                    uri,
                    mimeType: image.mimeType
                }
            };
        }
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_SEEDANCE_IMAGE_REFERENCE_UNSUPPORTED',
                'Seedance image input must reference asset://, http://, or https:// URI',
                { uri }
            )
        };
    }

    public async generateVideo(request: {
        prompt: string;
        model: string;
        inputImages?: IPortBinaryValue[];
        durationSeconds?: number;
        aspectRatio?: string;
        seed?: number;
        pollIntervalMs: number;
        pollTimeoutMs: number;
    }): Promise<TResult<IPortBinaryValue, IDagError>> {
        if (!this.provider) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_BYTEDANCE_CONFIG_REQUIRED',
                    'BYTEDANCE_API_KEY(or ARK_API_KEY) and BYTEDANCE_BASE_URL must be configured for Seedance runtime'
                )
            };
        }
        const selectedModel = request.model.trim().length > 0 ? request.model.trim() : this.defaultModel;
        if (this.allowedModels.length > 0 && !this.allowedModels.includes(selectedModel)) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_SEEDANCE_MODEL_NOT_ALLOWED',
                    'Selected Seedance model is not allowed in DAG runtime',
                    { model: selectedModel }
                )
            };
        }
        const prompt = request.prompt.trim();
        if (prompt.length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_SEEDANCE_PROMPT_REQUIRED',
                    'Seedance prompt must be non-empty'
                )
            };
        }
        const inputImages: TImageInputSource[] = [];
        if (Array.isArray(request.inputImages) && request.inputImages.length > 0) {
            for (const [index, image] of request.inputImages.entries()) {
                const imageSourceResult = await this.resolveImageInputSource(image);
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
                inputImages.push(imageSourceResult.value);
            }
        }

        const acceptedResult = await this.provider.createVideo({
            prompt,
            model: selectedModel,
            durationSeconds: request.durationSeconds,
            aspectRatio: request.aspectRatio,
            seed: request.seed,
            inputImages: inputImages.length > 0 ? inputImages : undefined
        });
        if (!acceptedResult.ok) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_SEEDANCE_CREATE_FAILED',
                    acceptedResult.error.message,
                    false,
                    { code: acceptedResult.error.code, model: selectedModel }
                )
            };
        }
        const deadlineEpochMs = Date.now() + request.pollTimeoutMs;

        while (true) {
            const snapshotResult = await this.provider.getVideoJob(acceptedResult.value.jobId);
            if (!snapshotResult.ok) {
                return {
                    ok: false,
                    error: buildTaskExecutionError(
                        'DAG_TASK_EXECUTION_SEEDANCE_POLL_FAILED',
                        snapshotResult.error.message,
                        false,
                        { code: snapshotResult.error.code, jobId: acceptedResult.value.jobId }
                    )
                };
            }
            const snapshot = snapshotResult.value;
            if (snapshot.status === 'succeeded') {
                return toOutputVideo(snapshot.output);
            }
            if (snapshot.status === 'failed') {
                const failedMessage = snapshot.error?.message ?? 'Seedance job failed without explicit error message';
                return {
                    ok: false,
                    error: buildTaskExecutionError(
                        'DAG_TASK_EXECUTION_SEEDANCE_JOB_FAILED',
                        failedMessage,
                        false,
                        { jobId: snapshot.jobId, status: snapshot.status }
                    )
                };
            }
            if (snapshot.status === 'cancelled') {
                return {
                    ok: false,
                    error: buildTaskExecutionError(
                        'DAG_TASK_EXECUTION_SEEDANCE_JOB_CANCELLED',
                        'Seedance job was cancelled before completion',
                        false,
                        { jobId: snapshot.jobId, status: snapshot.status }
                    )
                };
            }
            if (Date.now() >= deadlineEpochMs) {
                return {
                    ok: false,
                    error: buildTaskExecutionError(
                        'DAG_TASK_EXECUTION_SEEDANCE_TIMEOUT',
                        'Seedance video generation timed out',
                        true,
                        { jobId: snapshot.jobId, pollTimeoutMs: request.pollTimeoutMs }
                    )
                };
            }
            await sleep(request.pollIntervalMs);
        }
    }
}

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
        const imageSurcharge = Array.isArray(imagesInput) && imagesInput.length > 0 ? 0.02 : 0;
        const estimatedCostUsd = config.baseCostUsd + imageSurcharge;
        return {
            ok: true,
            value: { estimatedCostUsd }
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
