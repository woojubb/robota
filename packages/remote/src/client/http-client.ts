/**
 * HTTP Client - Simple & Type Safe
 * 
 * Clean HTTP client using atomic components for maximum type safety
 */

import type { HttpRequest, HttpResponse, DefaultRequestData } from '../types/http-types';
import type { SimpleLogger } from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';
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
    logger?: SimpleLogger;
}

/**
 * Simple HTTP Client for Remote Communication
 */
export class HttpClient {
    private config: HttpClientConfig;
    private readonly logger: SimpleLogger;

    constructor(config: HttpClientConfig) {
        this.config = config;
        this.logger = config.logger || SilentLogger;
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
    async chat(messages: BasicMessage[], provider: string, model: string, tools?: any[]): Promise<ResponseMessage> {
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
        const response = await this.post<typeof requestData, DefaultRequestData>('/chat', requestData);

        // Extract assistant message preserving toolCalls if present
        const responseData = response.data as DefaultRequestData;
        const dataMessage = (responseData && typeof responseData === 'object' && 'data' in responseData)
            ? (responseData['data'] as DefaultRequestData)
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
    async *chatStream(messages: BasicMessage[], provider: string, model: string, tools?: any[]): AsyncGenerator<ResponseMessage> {
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

                                // ✅ 서버가 원본 TUniversalMessage를 직접 보내므로 래핑 해제 불필요
                                const responseData = parsed;

                                if (responseData && responseData.role === 'assistant') {
                                    // 🔍 디버깅: 파싱된 데이터 확인
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
                                            // ✅ toolCalls가 있으면 무조건 전달 (빈 ID 조각들도 포함)
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