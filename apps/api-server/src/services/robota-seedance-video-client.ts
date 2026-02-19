import type {
    IVideoGenerationProvider,
    IVideoJobSnapshot,
    TImageInputSource
} from '@robota-sdk/agents';
import { BytedanceProvider } from '@robota-sdk/bytedance';
import {
    buildTaskExecutionError,
    buildValidationError,
    type IDagError,
    type IPortBinaryValue,
    type TResult
} from '@robota-sdk/dag-core';
import type {
    ISeedanceVideoClient,
    ISeedanceVideoRequest
} from '@robota-sdk/dag-node-seedance-video';
import { LocalFsAssetStore } from './local-fs-asset-store.js';

const DEFAULT_SEEDANCE_MODEL = 'seedance-1-5-pro-251215';
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_POLL_TIMEOUT_MS = 180_000;

interface IRobotaSeedanceVideoClientOptions {
    apiKey?: string;
    baseUrl?: string;
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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
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

function parseAssetIdFromAssetUri(uri: string): string | undefined {
    if (!uri.startsWith('asset://')) {
        return undefined;
    }
    const rawAssetId = uri.slice('asset://'.length).trim();
    return rawAssetId.length > 0 ? rawAssetId : undefined;
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

export class RobotaSeedanceVideoClient implements ISeedanceVideoClient {
    private readonly provider?: IVideoGenerationProvider;
    private readonly assetStore: LocalFsAssetStore;
    private readonly defaultModel: string;
    private readonly allowedModels: string[];

    public constructor(options: IRobotaSeedanceVideoClientOptions) {
        if (
            typeof options.apiKey === 'string'
            && options.apiKey.trim().length > 0
            && typeof options.baseUrl === 'string'
            && options.baseUrl.trim().length > 0
        ) {
            this.provider = new BytedanceProvider({
                apiKey: options.apiKey.trim(),
                baseUrl: options.baseUrl.trim()
            });
        }
        this.assetStore = options.assetStore;
        this.defaultModel = options.defaultModel;
        this.allowedModels = options.allowedModels;
    }

    private async resolveImageInputSource(image: IPortBinaryValue): Promise<TResult<TImageInputSource, IDagError>> {
        const explicitAssetId = typeof image.assetId === 'string' && image.assetId.trim().length > 0
            ? image.assetId.trim()
            : undefined;
        const uriAssetId = parseAssetIdFromAssetUri(image.uri);
        const assetId = explicitAssetId ?? uriAssetId;
        if (typeof assetId === 'string') {
            const content = await this.assetStore.getContent(assetId);
            if (!content) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_SEEDANCE_IMAGE_ASSET_NOT_FOUND',
                        'Seedance image asset was not found',
                        { assetId }
                    )
                };
            }
            const buffer = await readStreamToBuffer(content.stream);
            return {
                ok: true,
                value: {
                    kind: 'inline',
                    mimeType: content.metadata.mediaType,
                    data: buffer.toString('base64')
                }
            };
        }
        if (image.uri.startsWith('http://') || image.uri.startsWith('https://')) {
            return {
                ok: true,
                value: {
                    kind: 'uri',
                    uri: image.uri,
                    mimeType: image.mimeType
                }
            };
        }
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_SEEDANCE_IMAGE_REFERENCE_UNSUPPORTED',
                'Seedance image input must reference asset://, http://, or https:// URI',
                { uri: image.uri }
            )
        };
    }

    public async generateVideo(request: ISeedanceVideoRequest): Promise<TResult<IPortBinaryValue, IDagError>> {
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
                            { index, ...imageSourceResult.error.details }
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
        const pollIntervalMs = request.pollIntervalMs > 0 ? request.pollIntervalMs : DEFAULT_POLL_INTERVAL_MS;
        const pollTimeoutMs = request.pollTimeoutMs > 0 ? request.pollTimeoutMs : DEFAULT_POLL_TIMEOUT_MS;
        const deadlineEpochMs = Date.now() + pollTimeoutMs;

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
                        { jobId: snapshot.jobId, pollTimeoutMs }
                    )
                };
            }
            await sleep(pollIntervalMs);
        }
    }
}

export function createRobotaSeedanceVideoClientFromEnv(assetStore: LocalFsAssetStore): RobotaSeedanceVideoClient {
    const apiKey = process.env.BYTEDANCE_API_KEY ?? process.env.ARK_API_KEY;
    const baseUrl = process.env.BYTEDANCE_BASE_URL;
    const defaultModelRaw = process.env.DAG_SEEDANCE_DEFAULT_MODEL;
    const defaultModel = typeof defaultModelRaw === 'string' && defaultModelRaw.trim().length > 0
        ? defaultModelRaw.trim()
        : DEFAULT_SEEDANCE_MODEL;
    const allowedModels = parseCsv(process.env.DAG_SEEDANCE_ALLOWED_MODELS);
    const resolvedAllowedModels = allowedModels.length > 0
        ? allowedModels
        : [defaultModel];
    return new RobotaSeedanceVideoClient({
        apiKey,
        baseUrl,
        assetStore,
        defaultModel,
        allowedModels: resolvedAllowedModels
    });
}
