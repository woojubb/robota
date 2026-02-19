import type {
    IInlineImageInputSource,
    IUriImageInputSource,
    IProviderMediaError,
    TProviderMediaResult,
    IVideoGenerationProvider,
    IVideoGenerationRequest,
    IVideoJobAccepted,
    IVideoJobSnapshot
} from '@robota-sdk/agents';
import type {
    IBytedanceApiErrorResponse,
    IBytedanceCreateVideoTaskRequest,
    IBytedanceCreateVideoTaskResponse,
    IBytedanceProviderOptions,
    IBytedanceVideoTaskResponse,
    TBytedanceTaskContent
} from './types';

const DEFAULT_CREATE_VIDEO_PATH = '/contents/generations/tasks';
const DEFAULT_GET_VIDEO_TASK_PATH_TEMPLATE = '/contents/generations/tasks/{taskId}';
const DEFAULT_CANCEL_VIDEO_TASK_PATH_TEMPLATE = '/contents/generations/tasks/{taskId}';
const DEFAULT_TIMEOUT_MS = 60_000;

export class BytedanceProvider implements IVideoGenerationProvider {
    private readonly options: IBytedanceProviderOptions;

    public constructor(options: IBytedanceProviderOptions) {
        this.options = options;
    }

    public async createVideo(request: IVideoGenerationRequest): Promise<TProviderMediaResult<IVideoJobAccepted>> {
        if (request.prompt.trim().length === 0) {
            return this.buildInvalidRequestError('Video generation requires non-empty prompt.');
        }
        if (request.model.trim().length === 0) {
            return this.buildInvalidRequestError('Video generation requires non-empty model.');
        }
        if (typeof request.seed === 'number') {
            return this.buildInvalidRequestError('ModelArk Seedance provider does not support seed field in current contract.');
        }

        const contentResult = this.buildContentPayload(request.prompt, request.inputImages);
        if (!contentResult.ok) {
            return contentResult;
        }

        const payload: IBytedanceCreateVideoTaskRequest = {
            model: request.model.trim(),
            content: contentResult.value,
            duration: request.durationSeconds,
            ratio: request.aspectRatio
        };

        const responseResult = await this.requestJson<IBytedanceCreateVideoTaskResponse>({
            path: this.options.createVideoPath ?? DEFAULT_CREATE_VIDEO_PATH,
            method: 'POST',
            body: JSON.stringify(payload)
        });
        if (!responseResult.ok) {
            return responseResult;
        }

        if (responseResult.value.id.trim().length === 0) {
            return this.buildUpstreamError('Bytedance createVideo response is missing task id.');
        }
        const mappedStatus = this.mapInitialStatus(responseResult.value.status);
        if (!mappedStatus.ok) {
            return mappedStatus;
        }
        return {
            ok: true,
            value: {
                jobId: responseResult.value.id,
                status: mappedStatus.value,
                createdAt: this.toIsoTimestamp(responseResult.value.created_at)
            }
        };
    }

    public async getVideoJob(jobId: string): Promise<TProviderMediaResult<IVideoJobSnapshot>> {
        if (jobId.trim().length === 0) {
            return this.buildInvalidRequestError('Video job lookup requires non-empty jobId.');
        }

        const responseResult = await this.requestJson<IBytedanceVideoTaskResponse>({
            path: this.buildPath(
                this.options.getVideoTaskPathTemplate ?? DEFAULT_GET_VIDEO_TASK_PATH_TEMPLATE,
                jobId
            ),
            method: 'GET'
        });
        if (!responseResult.ok) {
            return responseResult;
        }
        return this.mapVideoJobSnapshot(responseResult.value);
    }

    public async cancelVideoJob(jobId: string): Promise<TProviderMediaResult<IVideoJobSnapshot>> {
        if (jobId.trim().length === 0) {
            return this.buildInvalidRequestError('Video job cancellation requires non-empty jobId.');
        }

        const cancelMethod = this.options.cancelVideoTaskMethod ?? 'DELETE';
        const responseResult = await this.requestJson<IBytedanceVideoTaskResponse>({
            path: this.buildPath(
                this.options.cancelVideoTaskPathTemplate ?? DEFAULT_CANCEL_VIDEO_TASK_PATH_TEMPLATE,
                jobId
            ),
            method: cancelMethod
        });
        if (!responseResult.ok) {
            return responseResult;
        }
        return this.mapVideoJobSnapshot(responseResult.value);
    }

    private async requestJson<TResponse>(
        request: {
            path: string;
            method: 'GET' | 'POST' | 'DELETE';
            body?: string;
        }
    ): Promise<TProviderMediaResult<TResponse>> {
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        try {
            const response = await fetch(this.buildUrl(request.path), {
                method: request.method,
                headers: {
                    Authorization: `Bearer ${this.options.apiKey}`,
                    'Content-Type': 'application/json',
                    ...(this.options.defaultHeaders ?? {})
                },
                body: request.body,
                signal: controller.signal
            });
            const responseText = await response.text();
            if (!response.ok) {
                return this.mapHttpError(response.status, responseText);
            }

            const parsedResult = this.parseJsonRecord(responseText);
            if (!parsedResult.ok) {
                return parsedResult;
            }
            return {
                ok: true,
                value: parsedResult.value as TResponse
            };
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                return {
                    ok: false,
                    error: {
                        code: 'PROVIDER_TIMEOUT',
                        message: 'Bytedance media request timed out.'
                    }
                };
            }
            return {
                ok: false,
                error: {
                    code: 'PROVIDER_UPSTREAM_ERROR',
                    message: error instanceof Error ? error.message : 'Bytedance media request failed.'
                }
            };
        } finally {
            clearTimeout(timeoutHandle);
        }
    }

    private parseJsonRecord(
        responseText: string
    ): TProviderMediaResult<Record<string, string | number | boolean | undefined>> {
        try {
            const parsedValue = JSON.parse(responseText) as Record<string, string | number | boolean | undefined>;
            return {
                ok: true,
                value: parsedValue
            };
        } catch {
            return {
                ok: false,
                error: {
                    code: 'PROVIDER_UPSTREAM_ERROR',
                    message: 'Bytedance response is not valid JSON.'
                }
            };
        }
    }

    private mapHttpError(statusCode: number, responseText: string): TProviderMediaResult<never> {
        const parsedError = this.parseErrorResponse(responseText);
        if (statusCode === 401 || statusCode === 403) {
            return {
                ok: false,
                error: {
                    code: 'PROVIDER_AUTH_ERROR',
                    message: parsedError.message ?? 'Bytedance authentication failed.',
                    details: parsedError.details
                }
            };
        }
        if (statusCode === 404) {
            return {
                ok: false,
                error: {
                    code: 'PROVIDER_JOB_NOT_FOUND',
                    message: parsedError.message ?? 'Bytedance video job was not found.',
                    details: parsedError.details
                }
            };
        }
        if (statusCode === 409) {
            return {
                ok: false,
                error: {
                    code: 'PROVIDER_JOB_NOT_CANCELLABLE',
                    message: parsedError.message ?? 'Bytedance video job cannot be cancelled in current state.',
                    details: parsedError.details
                }
            };
        }
        if (statusCode === 429) {
            return {
                ok: false,
                error: {
                    code: 'PROVIDER_RATE_LIMITED',
                    message: parsedError.message ?? 'Bytedance rate limit exceeded.',
                    details: parsedError.details
                }
            };
        }
        if (statusCode >= 400 && statusCode < 500) {
            return {
                ok: false,
                error: {
                    code: 'PROVIDER_INVALID_REQUEST',
                    message: parsedError.message ?? 'Bytedance rejected request payload.',
                    details: parsedError.details
                }
            };
        }
        return {
            ok: false,
            error: {
                code: 'PROVIDER_UPSTREAM_ERROR',
                message: parsedError.message ?? 'Bytedance upstream request failed.',
                details: parsedError.details
            }
        };
    }

    private parseErrorResponse(responseText: string): IBytedanceApiErrorResponse {
        try {
            return JSON.parse(responseText) as IBytedanceApiErrorResponse;
        } catch {
            return {
                message: responseText
            };
        }
    }

    private mapVideoJobSnapshot(response: IBytedanceVideoTaskResponse): TProviderMediaResult<IVideoJobSnapshot> {
        if (response.id.trim().length === 0) {
            return this.buildUpstreamError('Bytedance video job response is missing task id.');
        }
        const normalizedStatusResult = this.mapVideoStatus(response.status);
        if (!normalizedStatusResult.ok) {
            return normalizedStatusResult;
        }
        return {
            ok: true,
            value: {
                jobId: response.id,
                status: normalizedStatusResult.value,
                output: this.mapOutput(response),
                error: normalizedStatusResult.value === 'failed' && response.error_message
                    ? {
                        code: 'PROVIDER_UPSTREAM_ERROR',
                        message: response.error_message
                    }
                    : undefined,
                updatedAt: this.toIsoTimestamp(response.updated_at ?? response.created_at)
            }
        };
    }

    private mapVideoStatus(status: string): TProviderMediaResult<IVideoJobSnapshot['status']> {
        const normalized = status.trim().toLowerCase();
        if (normalized === 'queued' || normalized === 'pending' || normalized === 'submitted') {
            return { ok: true, value: 'queued' };
        }
        if (normalized === 'running' || normalized === 'processing' || normalized === 'in_progress') {
            return { ok: true, value: 'running' };
        }
        if (normalized === 'succeeded' || normalized === 'success' || normalized === 'completed') {
            return { ok: true, value: 'succeeded' };
        }
        if (normalized === 'failed' || normalized === 'error') {
            return { ok: true, value: 'failed' };
        }
        if (normalized === 'cancelled' || normalized === 'canceled') {
            return { ok: true, value: 'cancelled' };
        }
        return {
            ok: false,
            error: {
                code: 'PROVIDER_UPSTREAM_ERROR',
                message: `Unexpected video job status from Bytedance: ${status}`
            }
        };
    }

    private mapOutput(response: IBytedanceVideoTaskResponse): IVideoJobSnapshot['output'] {
        const directVideoUrl = typeof response.video_url === 'string' && response.video_url.trim().length > 0
            ? response.video_url
            : undefined;
        const contentVideoUrl = typeof response.content?.video_url === 'string'
            && response.content.video_url.trim().length > 0
            ? response.content.video_url
            : undefined;
        const resolvedVideoUrl = directVideoUrl ?? contentVideoUrl;
        if (typeof resolvedVideoUrl !== 'string') {
            return undefined;
        }
        return {
            kind: 'uri',
            uri: resolvedVideoUrl,
            mimeType: response.mime_type,
            bytes: response.bytes
        };
    }

    private buildUrl(path: string): string {
        const sanitizedBaseUrl = this.options.baseUrl.endsWith('/')
            ? this.options.baseUrl.slice(0, -1)
            : this.options.baseUrl;
        const sanitizedPath = path.startsWith('/') ? path : `/${path}`;
        return `${sanitizedBaseUrl}${sanitizedPath}`;
    }

    private buildPath(template: string, taskId: string): string {
        return template.replace('{taskId}', encodeURIComponent(taskId));
    }

    private buildInvalidRequestError(message: string): TProviderMediaResult<never> {
        return {
            ok: false,
            error: {
                code: 'PROVIDER_INVALID_REQUEST',
                message
            }
        };
    }

    private buildUpstreamError(message: string): TProviderMediaResult<never> {
        return {
            ok: false,
            error: {
                code: 'PROVIDER_UPSTREAM_ERROR',
                message
            }
        };
    }

    private toIsoTimestamp(value: string | number | undefined): string {
        if (typeof value === 'number' && Number.isFinite(value)) {
            const numericTimestamp = value > 1_000_000_000_000 ? value : value * 1000;
            const date = new Date(numericTimestamp);
            if (!Number.isNaN(date.getTime())) {
                return date.toISOString();
            }
        }
        if (typeof value === 'string' && value.trim().length > 0) {
            const maybeNumeric = Number(value);
            if (Number.isFinite(maybeNumeric)) {
                return this.toIsoTimestamp(maybeNumeric);
            }
            const parsedDate = new Date(value);
            if (!Number.isNaN(parsedDate.getTime())) {
                return parsedDate.toISOString();
            }
        }
        return new Date().toISOString();
    }

    private buildContentPayload(
        prompt: string,
        inputImages: IVideoGenerationRequest['inputImages']
    ): TProviderMediaResult<TBytedanceTaskContent[]> {
        const normalizedPrompt = prompt.trim();
        if (normalizedPrompt.length === 0) {
            return this.buildInvalidRequestError('Video generation requires non-empty prompt.');
        }
        const content: TBytedanceTaskContent[] = [
            {
                type: 'text',
                text: normalizedPrompt
            }
        ];
        if (Array.isArray(inputImages)) {
            for (const image of inputImages) {
                const imageUrlResult = this.toContentImageUrl(image);
                if (!imageUrlResult.ok) {
                    return imageUrlResult;
                }
                content.push({
                    type: 'image_url',
                    image_url: {
                        url: imageUrlResult.value
                    }
                });
            }
        }
        return {
            ok: true,
            value: content
        };
    }

    private toContentImageUrl(image: IInlineImageInputSource | IUriImageInputSource): TProviderMediaResult<string> {
        if (image.kind === 'uri') {
            if (image.uri.trim().length === 0) {
                return this.buildInvalidRequestError('Image uri must be non-empty.');
            }
            return {
                ok: true,
                value: image.uri
            };
        }
        if (image.data.trim().length === 0) {
            return this.buildInvalidRequestError('Inline image data must be non-empty.');
        }
        if (image.mimeType.trim().length === 0) {
            return this.buildInvalidRequestError('Inline image mimeType must be non-empty.');
        }
        return {
            ok: true,
            value: `data:${image.mimeType};base64,${image.data}`
        };
    }

    private mapInitialStatus(statusValue: string | undefined): TProviderMediaResult<'queued' | 'running'> {
        if (typeof statusValue !== 'string' || statusValue.trim().length === 0) {
            return {
                ok: true,
                value: 'queued'
            };
        }
        const normalizedStatus = statusValue.trim().toLowerCase();
        if (normalizedStatus === 'queued' || normalizedStatus === 'pending' || normalizedStatus === 'submitted') {
            return { ok: true, value: 'queued' };
        }
        if (normalizedStatus === 'running' || normalizedStatus === 'processing' || normalizedStatus === 'in_progress') {
            return { ok: true, value: 'running' };
        }
        return {
            ok: false,
            error: {
                code: 'PROVIDER_UPSTREAM_ERROR',
                message: `Unexpected createVideo status from Bytedance: ${statusValue}`
            }
        };
    }
}
