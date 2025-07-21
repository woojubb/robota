/**
 * HTTP Client - Simple & Type Safe
 * 
 * Clean HTTP client using atomic components for maximum type safety
 */

import type { HttpRequest, HttpResponse, DefaultRequestData } from '../types/http-types';
import type { BasicMessage, ResponseMessage } from '../types/message-types';
import {
    createHttpRequest,
    createHttpResponse,
    extractContent,
    generateId,
    toResponseMessage
} from '../utils/transformers';
// Simple inline type checking instead of external type guards

export interface HttpClientConfig {
    baseUrl: string;
    timeout: number;
    headers: Record<string, string>;
}

/**
 * Simple HTTP Client for Remote Communication
 */
export class HttpClient {
    private config: HttpClientConfig;

    constructor(config: HttpClientConfig) {
        this.config = config;
    }

    /**
     * Send POST request with type safety
     */
    async post<TData extends DefaultRequestData, TResponse>(
        endpoint: string,
        data: TData
    ): Promise<HttpResponse<TResponse>> {
        const request = createHttpRequest(
            generateId('post'),
            `${this.config.baseUrl}${endpoint}`,
            'POST',
            data,
            this.config.headers
        );

        return await this.executeRequest<TResponse>(request);
    }

    /**
     * Send GET request with type safety
     */
    async get<TResponse>(endpoint: string): Promise<HttpResponse<TResponse>> {
        const request = createHttpRequest<undefined>(
            generateId('get'),
            `${this.config.baseUrl}${endpoint}`,
            'GET',
            undefined,
            this.config.headers
        );

        return await this.executeRequest<TResponse>(request);
    }

    /**
     * Execute chat request specifically
     */
    async chat(messages: BasicMessage[], provider: string, model: string): Promise<ResponseMessage> {
        const requestData = {
            messages: messages.map(msg => ({
                role: msg.role,
                content: msg.content
            })),
            provider,
            model
        };

        const response = await this.post<typeof requestData, { content: string; provider?: string; model?: string }>(
            '/chat',
            requestData
        );

        return toResponseMessage(
            { role: 'assistant', content: extractContent(response) },
            response.data.provider,
            response.data.model
        );
    }

    /**
     * Execute HTTP request with error handling
     */
    private async executeRequest<TResponse>(request: HttpRequest<DefaultRequestData> | HttpRequest<undefined>): Promise<HttpResponse<TResponse>> {
        try {
            const fetchResponse = await fetch(request.url, {
                method: request.method,
                headers: request.headers as HeadersInit,
                body: request.data ? JSON.stringify(request.data) : null
            });

            if (!fetchResponse.ok) {
                throw new Error(`HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`);
            }

            const responseData = await fetchResponse.json();

            return createHttpResponse<TResponse>(
                request.id,
                fetchResponse.status,
                responseData as TResponse,
                this.getResponseHeaders(fetchResponse)
            );

        } catch (error) {
            throw new Error(`Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Extract response headers safely
     */
    private getResponseHeaders(response: Response): Record<string, string> {
        const headers: Record<string, string> = {};

        response.headers.forEach((value, key) => {
            headers[key] = value;
        });

        return headers;
    }

    /**
     * Validate configuration
     */
    validateConfig(): boolean {
        return (
            typeof this.config.baseUrl === 'string' &&
            this.config.baseUrl.length > 0 &&
            typeof this.config.timeout === 'number' &&
            this.config.timeout > 0 &&
            typeof this.config.headers === 'object' &&
            this.config.headers !== null
        );
    }
} 