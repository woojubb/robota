/**
 * Transformers - Pure Transformation Functions
 * 
 * Single responsibility: Transform data between different formats
 */

import type { IBasicMessage, IResponseMessage, IRequestMessage } from '../types/message-types';
import type { IHttpRequest, IHttpResponse, TDefaultRequestData, THttpMethod } from '../types/http-types';
import type { TUniversalValue } from '@robota-sdk/agents';
// Simple utility functions for basic type checking

/**
 * Transform basic message to request message
 */
export function toRequestMessage<TUniversalMessage extends IBasicMessage>(
    message: TUniversalMessage,
    provider: string,
    model: string
): IRequestMessage {
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
export function toResponseMessage<TUniversalMessage extends IBasicMessage>(
    message: TUniversalMessage,
    provider?: string,
    model?: string
): IResponseMessage {
    const response: IResponseMessage = {
        role: message.role,
        content: message.content,
        timestamp: new Date()
    };

    if (provider !== undefined) {
        response.provider = provider;
    }

    if (model !== undefined) {
        response.model = model;
    }

    // Preserve toolCalls data (type assertion is used here)
    const toolCalls = (message as Partial<IResponseMessage>).toolCalls;
    if (toolCalls && Array.isArray(toolCalls)) {
        response.toolCalls = toolCalls;
    }

    return response;
}

/**
 * Create HTTP request with type safety
 */
export function createHttpRequest<TData>(
    id: string,
    url: string,
    method: THttpMethod,
    data?: TData,
    headers: Record<string, string> = {}
): IHttpRequest<TData> {
    const request: IHttpRequest<TData> = {
        id,
        url,
        method,
        headers: {
            'Content-Type': 'application/json',
            ...headers
        }
    };

    if (data !== undefined) {
        request.data = data;
    }

    return request;
}

/**
 * Create HTTP response with type safety
 */
export function createHttpResponse<TData>(
    id: string,
    status: number,
    data: TData,
    headers: Record<string, string> = {}
): IHttpResponse<TData> {
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
export function extractContent(response: IHttpResponse<TDefaultRequestData>): string {
    // Check for nested data structure: response.data.data.content
    if ('data' in response.data) {
        const nestedData = response.data['data'];
        if (nestedData !== null && typeof nestedData === 'object' && 'content' in nestedData) {
            const content = (nestedData as Record<string, TUniversalValue>)['content'];
            return typeof content === 'string' ? content : '';
        }
    }

    // Fallback to original structure: response.data.content
    if ('content' in response.data) {
        const content = response.data['content'];
        return typeof content === 'string' ? content : '';
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
        if (value !== null && value !== undefined) {
            normalized[key] = String(value);
        }
    }

    return normalized;
}

/**
 * Safe JSON parse with basic error handling
 */
export function safeJsonParse<T>(jsonString: string): T | null {
    try {
        return JSON.parse(jsonString) as T;
    } catch {
        return null;
    }
} 