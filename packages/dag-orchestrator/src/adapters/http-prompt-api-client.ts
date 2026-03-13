import type {
    IPromptRequest,
    IPromptResponse,
    IQueueStatus,
    IQueueAction,
    THistory,
    TObjectInfo,
    ISystemStats,
    TResult,
    IDagError,
} from '@robota-sdk/dag-core';
import type { IPromptApiClientPort } from '../interfaces/prompt-api-client-port.js';

/**
 * HTTP-based Prompt API client.
 *
 * Implements IPromptApiClientPort by making HTTP requests to a Prompt API server.
 * The server can be either:
 *   - Robota DAG API server (dag-server-core)
 *   - ComfyUI server (native Python)
 *
 * Both expose the same REST endpoints and JSON shapes,
 * so a single client works for either backend.
 */
export class HttpPromptApiClient implements IPromptApiClientPort {
    constructor(private readonly baseUrl: string) {}

    async submitPrompt(request: IPromptRequest): Promise<TResult<IPromptResponse, IDagError>> {
        return this.post<IPromptResponse>('/prompt', request);
    }

    async getQueue(): Promise<TResult<IQueueStatus, IDagError>> {
        return this.get<IQueueStatus>('/queue');
    }

    async manageQueue(action: IQueueAction): Promise<TResult<void, IDagError>> {
        return this.post<void>('/queue', action);
    }

    async getHistory(promptId?: string): Promise<TResult<THistory, IDagError>> {
        const path = promptId ? `/history/${encodeURIComponent(promptId)}` : '/history';
        return this.get<THistory>(path);
    }

    async getObjectInfo(nodeType?: string): Promise<TResult<TObjectInfo, IDagError>> {
        const path = nodeType ? `/object_info/${encodeURIComponent(nodeType)}` : '/object_info';
        return this.get<TObjectInfo>(path);
    }

    async getSystemStats(): Promise<TResult<ISystemStats, IDagError>> {
        return this.get<ISystemStats>('/system_stats');
    }

    private async get<T>(path: string): Promise<TResult<T, IDagError>> {
        try {
            const response = await fetch(`${this.baseUrl}${path}`);
            return this.handleResponse<T>(response);
        } catch (error: unknown) {
            return this.networkError(error);
        }
    }

    private async post<T>(path: string, body: unknown): Promise<TResult<T, IDagError>> {
        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            return this.handleResponse<T>(response);
        } catch (error: unknown) {
            return this.networkError(error);
        }
    }

    private async handleResponse<T>(response: Response): Promise<TResult<T, IDagError>> {
        const body = await response.json() as Record<string, unknown>;

        if (!response.ok) {
            const errorBody = body as { error?: { type?: string; message?: string } };
            return {
                ok: false,
                error: {
                    code: errorBody.error?.type ?? `HTTP_${response.status}`,
                    category: 'validation',
                    message: errorBody.error?.message ?? response.statusText,
                    retryable: response.status >= 500,
                },
            };
        }

        return { ok: true, value: body as T };
    }

    private networkError<T>(error: unknown): TResult<T, IDagError> {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            error: {
                code: 'NETWORK_ERROR',
                category: 'dispatch',
                message: `Failed to connect to Prompt API at ${this.baseUrl}: ${message}`,
                retryable: true,
            },
        };
    }
}
