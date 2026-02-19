import type {
    IProviderMediaError,
    TProviderMediaResult,
    IVideoGenerationProvider,
    IVideoGenerationRequest,
    IVideoJobAccepted,
    IVideoJobSnapshot
} from '@robota-sdk/agents';
import type {
    IBytedanceApiErrorResponse,
    IBytedanceCreateVideoResponse,
    IBytedanceProviderOptions,
    IBytedanceVideoJobResponse
} from './types';

const DEFAULT_CREATE_VIDEO_PATH = '/seedance/v2/videos';
const DEFAULT_GET_VIDEO_JOB_PATH_TEMPLATE = '/seedance/v2/videos/{jobId}';
const DEFAULT_CANCEL_VIDEO_JOB_PATH_TEMPLATE = '/seedance/v2/videos/{jobId}/cancel';
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

        const responseResult = await this.requestJson<IBytedanceCreateVideoResponse>({
            path: this.options.createVideoPath ?? DEFAULT_CREATE_VIDEO_PATH,
            method: 'POST',
            body: JSON.stringify(request)
        });
        if (!responseResult.ok) {
            return responseResult;
        }

        if (responseResult.value.jobId.trim().length === 0) {
            return this.buildUpstreamError('Bytedance createVideo response is missing jobId.');
        }
        const mappedStatus = this.mapInitialStatus(responseResult.value.status);
        if (!mappedStatus.ok) {
            return mappedStatus;
        }
        return {
            ok: true,
            value: {
                jobId: responseResult.value.jobId,
                status: mappedStatus.value,
                createdAt: responseResult.value.createdAt ?? new Date().toISOString()
            }
        };
    }

    public async getVideoJob(jobId: string): Promise<TProviderMediaResult<IVideoJobSnapshot>> {
        if (jobId.trim().length === 0) {
            return this.buildInvalidRequestError('Video job lookup requires non-empty jobId.');
        }

        const responseResult = await this.requestJson<IBytedanceVideoJobResponse>({
            path: this.buildPath(
                this.options.getVideoJobPathTemplate ?? DEFAULT_GET_VIDEO_JOB_PATH_TEMPLATE,
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

        const responseResult = await this.requestJson<IBytedanceVideoJobResponse>({
            path: this.buildPath(
                this.options.cancelVideoJobPathTemplate ?? DEFAULT_CANCEL_VIDEO_JOB_PATH_TEMPLATE,
                jobId
            ),
            method: 'POST'
        });
        if (!responseResult.ok) {
            return responseResult;
        }
        return this.mapVideoJobSnapshot(responseResult.value);
    }

    private async requestJson<TResponse>(
        request: {
            path: string;
            method: 'GET' | 'POST';
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

    private mapInitialStatus(status: string): TProviderMediaResult<'queued' | 'running'> {
        const normalized = status.trim().toLowerCase();
        if (normalized === 'queued') {
            return { ok: true, value: 'queued' };
        }
        if (normalized === 'running') {
            return { ok: true, value: 'running' };
        }
        return {
            ok: false,
            error: {
                code: 'PROVIDER_UPSTREAM_ERROR',
                message: `Unexpected createVideo status from Bytedance: ${status}`
            }
        };
    }

    private mapVideoJobSnapshot(response: IBytedanceVideoJobResponse): TProviderMediaResult<IVideoJobSnapshot> {
        if (response.jobId.trim().length === 0) {
            return this.buildUpstreamError('Bytedance video job response is missing jobId.');
        }
        const normalizedStatusResult = this.mapVideoStatus(response.status);
        if (!normalizedStatusResult.ok) {
            return normalizedStatusResult;
        }
        return {
            ok: true,
            value: {
                jobId: response.jobId,
                status: normalizedStatusResult.value,
                output: this.mapOutput(response),
                error: normalizedStatusResult.value === 'failed' && response.errorMessage
                    ? {
                        code: 'PROVIDER_UPSTREAM_ERROR',
                        message: response.errorMessage
                    }
                    : undefined,
                updatedAt: response.updatedAt ?? new Date().toISOString()
            }
        };
    }

    private mapVideoStatus(status: string): TProviderMediaResult<IVideoJobSnapshot['status']> {
        const normalized = status.trim().toLowerCase();
        if (
            normalized === 'queued'
            || normalized === 'running'
            || normalized === 'succeeded'
            || normalized === 'failed'
            || normalized === 'cancelled'
        ) {
            return { ok: true, value: normalized };
        }
        return {
            ok: false,
            error: {
                code: 'PROVIDER_UPSTREAM_ERROR',
                message: `Unexpected video job status from Bytedance: ${status}`
            }
        };
    }

    private mapOutput(response: IBytedanceVideoJobResponse): IVideoJobSnapshot['output'] {
        if (typeof response.outputUrl !== 'string' || response.outputUrl.trim().length === 0) {
            return undefined;
        }
        return {
            kind: 'uri',
            uri: response.outputUrl,
            mimeType: response.mimeType,
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

    private buildPath(template: string, jobId: string): string {
        return template.replace('{jobId}', encodeURIComponent(jobId));
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
}
