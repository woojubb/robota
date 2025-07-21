/**
 * Transformers - Pure Transformation Functions
 * 
 * Single responsibility: Transform data between different formats
 */

import type { BasicMessage, ResponseMessage, RequestMessage } from '../types/message-types';
import type { HttpRequest, HttpResponse, DefaultRequestData } from '../types/http-types';
import { isObject, isString, type ValidatedInput } from './type-guards';

/**
 * Transform basic message to request message
 */
export function toRequestMessage<TMessage extends BasicMessage>(
    message: TMessage,
    provider: string,
    model: string
): RequestMessage {
    return {
        role: message.role,
        content: message.content,
        provider,
        model
    };
}

/**
 * Transform basic message to response message
 */
export function toResponseMessage<TMessage extends BasicMessage>(
    message: TMessage,
    provider?: string,
    model?: string
): ResponseMessage {
    return {
        role: message.role,
        content: message.content,
        timestamp: new Date(),
        provider,
        model
    };
}

/**
 * Create HTTP request with type safety
 */
export function createHttpRequest<TData>(
    id: string,
    url: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    data?: TData,
    headers: Record<string, string> = {}
): HttpRequest<TData> {
    return {
        id,
        url,
        method,
        headers: {
            'Content-Type': 'application/json',
            ...headers
        },
        data
    };
}

/**
 * Create HTTP response with type safety
 */
export function createHttpResponse<TData>(
    id: string,
    status: number,
    data: TData,
    headers: Record<string, string> = {}
): HttpResponse<TData> {
    return {
        id,
        status,
        headers,
        data,
        timestamp: new Date()
    };
}

/**
 * Extract content from response safely
 */
export function extractContent(response: HttpResponse<DefaultRequestData>): string {
    if (isObject(response.data) && 'content' in response.data && isString(response.data.content)) {
        return response.data.content;
    }
    return '';
}

/**
 * Generate unique ID
 */
export function generateId(prefix: string = 'id'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2)}`;
}

/**
 * Normalize headers to ensure type safety
 */
export function normalizeHeaders(headers: Record<string, string | number | boolean>): Record<string, string> {
    const normalized: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
        if (isString(value)) {
            normalized[key] = value;
        } else if (value !== null && value !== undefined) {
            normalized[key] = String(value);
        }
    }

    return normalized;
}

/**
 * Safe JSON parse with type checking - Project Compliant
 */
export function safeJsonParse<T extends ValidatedInput>(jsonString: string, typeGuard: (value: ValidatedInput) => value is T): T | null {
    try {
        const parsed = JSON.parse(jsonString) as ValidatedInput;
        return typeGuard(parsed) ? parsed : null;
    } catch {
        return null;
    }
} 