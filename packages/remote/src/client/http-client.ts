/**
 * HTTP Client - Simple & Type Safe
 * 
 * Clean HTTP client using atomic components for maximum type safety
 */

import type { IHttpRequest, IHttpResponse, TDefaultRequestData } from '../types/http-types';
import type { ILogger } from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';
import type { IBasicMessage, IResponseMessage } from '../types/message-types';
import {
    createHttpRequest,
    createHttpResponse,
    extractContent,
    generateId,
    toResponseMessage
} from '../utils/transformers';
// Simple inline type checking instead of external type guards

export interface IHttpClientConfig {
    baseUrl: string;
    timeout: number;
    headers: Record<string, string>;
    logger?: ILogger;
}

/**
 * Simple HTTP Client for Remote Communication
 */
export class HttpClient {
    private config: IHttpClientConfig;
    private readonly logger: ILogger;

    constructor(config: IHttpClientConfig) {
        this.config = config;
        this.logger = config.logger || SilentLogger;
    }

    /**
     * Send POST request with type safety
     */
    async post<TData extends TDefaultRequestData, TResponse>(
        endpoint: string,
        data: TData
    ): Promise<IHttpResponse<TResponse>> {
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
    async get<TResponse>(endpoint: string): Promise<IHttpResponse<TResponse>> {
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
    async chat(messages: IBasicMessage[], provider: string, model: string, tools?: any[]): Promise<IResponseMessage> {
        const requestData = {
            messages: messages.map(msg => {
                const base: any = {
                    role: msg.role,
                    content: msg.content
                };
                const anyMsg = msg as any;
                if (msg.role === 'assistant' && anyMsg.toolCalls && Array.isArray(anyMsg.toolCalls)) {
                    base.toolCalls = anyMsg.toolCalls;
                }
                if (msg.role === 'tool' && anyMsg.toolCallId) {
                    base.toolCallId = anyMsg.toolCallId;
                }
                return base;
            }),
            provider,
            model,
            ...(tools && tools.length > 0 && { tools })
        };

        this.logger.info('🔧 [HTTP-CLIENT] Non-streaming request tools:', tools?.length || 0);

        // Server responds with shape: { success: boolean, data: TUniversalMessage, provider, model }
        const response = await this.post<typeof requestData, TDefaultRequestData>('/chat', requestData);

        // Extract assistant message preserving toolCalls if present
        const responseData = response.data as TDefaultRequestData;
        const dataMessage = (responseData && typeof responseData === 'object' && 'data' in responseData)
            ? (responseData['data'] as TDefaultRequestData)
            : undefined;

        const assistantMessage: any = {
            role: (dataMessage && typeof dataMessage === 'object' && 'role' in dataMessage)
                ? (dataMessage as any).role
                : 'assistant',
            content: (dataMessage && typeof dataMessage === 'object' && 'content' in dataMessage)
                ? (dataMessage as any).content
                : extractContent(response)
        };

        // Preserve toolCalls when available (array of tool call fragments)
        if (dataMessage && typeof dataMessage === 'object' && 'toolCalls' in dataMessage) {
            const tc = (dataMessage as any).toolCalls;
            if (Array.isArray(tc)) {
                assistantMessage.toolCalls = tc;
            }
        }

        return toResponseMessage(
            assistantMessage,
            (responseData && (responseData as any).provider) ? (responseData as any).provider : undefined,
            (responseData && (responseData as any).model) ? (responseData as any).model : undefined
        );
    }

    /**
     * Execute streaming chat request
     */
    async *chatStream(messages: IBasicMessage[], provider: string, model: string, tools?: any[]): AsyncGenerator<IResponseMessage> {
        const url = `${this.config.baseUrl}/stream`;
        const body = {
            messages,
            provider,
            model,
            ...(tools && tools.length > 0 && { tools })
        };

        this.logger.info('🔧 [HTTP-CLIENT] Request tools:', tools?.length || 0);

        this.logger.info('🌐 HTTP chatStream request:', { url, provider, model, messagesCount: messages.length });

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body)
            });

            this.logger.info('🌐 HTTP response status:', response.status, response.statusText);

            if (!response.ok) {
                const errorText = await response.text();
                this.logger.error('❌ HTTP error response:', { status: response.status, statusText: response.statusText, body: errorText });
                throw new Error(`HTTP ${response.status}: ${response.statusText}\n${errorText}`);
            }

            if (!response.body) {
                throw new Error('No response body for streaming');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            try {
                while (true) {
                    const { done, value } = await reader.read();

                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.trim() === '') continue;

                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') {
                                return;
                            }

                            try {
                                const parsed = JSON.parse(data);

                                // The server sends the raw TUniversalMessage; no unwrapping is needed.
                                const responseData = parsed;

                                if (responseData && responseData.role === 'assistant') {
                                    // Debug: inspect parsed data
                                    this.logger.debug('🔍 [HTTP-CLIENT-PARSE] Parsed response data:', {
                                        role: responseData.role,
                                        content: responseData.content?.substring(0, 30) + '...',
                                        hasToolCalls: !!responseData.toolCalls,
                                        toolCallsLength: responseData.toolCalls?.length || 0,
                                        toolCallsData: responseData.toolCalls
                                    });

                                    yield toResponseMessage(
                                        {
                                            role: 'assistant',
                                            content: responseData.content || '',
                                            // Always forward toolCalls when present (including empty id fragments)
                                            ...(responseData.toolCalls && Array.isArray(responseData.toolCalls) &&
                                                { toolCalls: responseData.toolCalls })
                                        },
                                        provider,
                                        model
                                    );
                                }
                            } catch (parseError) {
                                // Skip invalid JSON
                                continue;
                            }
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }
        } catch (error) {
            throw new Error(`Streaming request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Execute HTTP request with error handling
     */
    private async executeRequest<TResponse>(request: IHttpRequest<TDefaultRequestData> | IHttpRequest<undefined>): Promise<IHttpResponse<TResponse>> {
        try {
            const requestInit: RequestInit = {
                method: request.method,
                headers: request.headers as HeadersInit,
            };

            // Only include `body` when request data is explicitly provided.
            // This preserves type-safety and keeps GET requests truly body-less.
            if (request.data !== undefined) {
                requestInit.body = JSON.stringify(request.data);
            }

            const fetchResponse = await fetch(request.url, requestInit);

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