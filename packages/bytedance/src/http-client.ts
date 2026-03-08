import type { TProviderMediaResult } from '@robota-sdk/agents';
import type { IBytedanceApiErrorResponse, IBytedanceProviderOptions } from './types';

const DEFAULT_TIMEOUT_MS = 60_000;

/** HTTP status codes used by the Bytedance API error mapper. */
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_BAD_REQUEST = 400;
const HTTP_INTERNAL_ERROR = 500;

/** Sends an HTTP request to the Bytedance API and returns the parsed JSON response. */
export async function requestJson<TResponse>(
    options: IBytedanceProviderOptions,
    request: {
        path: string;
        method: 'GET' | 'POST' | 'DELETE';
        body?: string;
    }
): Promise<TProviderMediaResult<TResponse>> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
        const response = await fetch(buildUrl(options.baseUrl, request.path), {
            method: request.method,
            headers: {
                Authorization: `Bearer ${options.apiKey}`,
                'Content-Type': 'application/json',
                ...(options.defaultHeaders ?? {})
            },
            body: request.body,
            signal: controller.signal
        });
        const responseText = await response.text();
        if (!response.ok) {
            return mapHttpError(response.status, responseText);
        }

        const parsedResult = parseJsonRecord(responseText);
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
                error: { code: 'PROVIDER_TIMEOUT', message: 'Bytedance media request timed out.' }
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

function buildUrl(baseUrl: string, path: string): string {
    const sanitizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const sanitizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${sanitizedBaseUrl}${sanitizedPath}`;
}

function parseJsonRecord(
    responseText: string
): TProviderMediaResult<Record<string, string | number | boolean | undefined>> {
    try {
        const parsedValue = JSON.parse(responseText) as Record<string, string | number | boolean | undefined>;
        return { ok: true, value: parsedValue };
    } catch {
        return {
            ok: false,
            error: { code: 'PROVIDER_UPSTREAM_ERROR', message: 'Bytedance response is not valid JSON.' }
        };
    }
}

function parseErrorResponse(responseText: string): IBytedanceApiErrorResponse {
    try {
        return JSON.parse(responseText) as IBytedanceApiErrorResponse;
    } catch {
        return { message: responseText };
    }
}

function mapHttpError(statusCode: number, responseText: string): TProviderMediaResult<never> {
    const parsedError = parseErrorResponse(responseText);
    if (statusCode === HTTP_UNAUTHORIZED || statusCode === HTTP_FORBIDDEN) {
        return { ok: false, error: { code: 'PROVIDER_AUTH_ERROR', message: parsedError.message ?? 'Bytedance authentication failed.', details: parsedError.details } };
    }
    if (statusCode === HTTP_NOT_FOUND) {
        return { ok: false, error: { code: 'PROVIDER_JOB_NOT_FOUND', message: parsedError.message ?? 'Bytedance video job was not found.', details: parsedError.details } };
    }
    if (statusCode === HTTP_CONFLICT) {
        return { ok: false, error: { code: 'PROVIDER_JOB_NOT_CANCELLABLE', message: parsedError.message ?? 'Bytedance video job cannot be cancelled in current state.', details: parsedError.details } };
    }
    if (statusCode === HTTP_TOO_MANY_REQUESTS) {
        return { ok: false, error: { code: 'PROVIDER_RATE_LIMITED', message: parsedError.message ?? 'Bytedance rate limit exceeded.', details: parsedError.details } };
    }
    if (statusCode >= HTTP_BAD_REQUEST && statusCode < HTTP_INTERNAL_ERROR) {
        return { ok: false, error: { code: 'PROVIDER_INVALID_REQUEST', message: parsedError.message ?? 'Bytedance rejected request payload.', details: parsedError.details } };
    }
    return { ok: false, error: { code: 'PROVIDER_UPSTREAM_ERROR', message: parsedError.message ?? 'Bytedance upstream request failed.', details: parsedError.details } };
}
