/**
 * HTTP Client - Simple & Type Safe
 *
 * Clean HTTP client using atomic components for maximum type safety
 */

import type { IHttpRequest, IHttpResponse, TDefaultRequestData } from '../types/http-types';
import type { ILogger, IToolSchema, IToolCall } from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';
import type { IBasicMessage, IResponseMessage } from '../types/message-types';
import {
    createHttpRequest,
    createHttpResponse,
    extractContent,
    generateId,
    toResponseMessage
} from '../utils/transformers';

export interface IHttpClientConfig {
    baseUrl: string;
    timeout: number;
    headers: Record<string, string>;
    logger?: ILogger;
}

/** Shape of a message sent in chat request body, including optional tool-related fields */
interface IChatRequestMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | null;
    toolCalls?: IToolCall[];
    toolCallId?: string;
}

/** Shape of the response payload from the chat endpoint */
interface IChatResponsePayload {
    success?: boolean;
    data?: {
        role?: string;
        content?: string;
        toolCalls?: IToolCall[];
    };
    provider?: string;
    model?: string;
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
    async chat(messages: IBasicMessage[], provider: string, model: string, tools?: IToolSchema[]): Promise<IResponseMessage> {
        const mappedMessages: IChatRequestMessage[] = messages.map((msg): IChatRequestMessage => {
            const mapped: IChatRequestMessage = {
                role: msg.role,
                content: msg.content
            };
            const msgWithToolCalls = msg as IBasicMessage & { toolCalls?: IToolCall[] };
            if (msg.role === 'assistant' && msgWithToolCalls.toolCalls && Array.isArray(msgWithToolCalls.toolCalls)) {
                mapped.toolCalls = msgWithToolCalls.toolCalls;
            }
            const msgWithToolCallId = msg as IBasicMessage & { toolCallId?: string };
            if (msg.role === 'tool' && msgWithToolCallId.toolCallId) {
                mapped.toolCallId = msgWithToolCallId.toolCallId;
            }
            return mapped;
        });

        const requestData: Record<string, unknown> = {
            messages: mappedMessages,
            provider,
            model,
            ...(tools && tools.length > 0 && { tools })
        };

        this.logger.info('🔧 [HTTP-CLIENT] Non-streaming request tools:', tools?.length || 0);

        // Server responds with shape: { success: boolean, data: TUniversalMessage, provider, model }
        const response = await this.post<TDefaultRequestData, TDefaultRequestData>('/chat', requestData as TDefaultRequestData);

        // Extract assistant message preserving toolCalls if present
        const responseData = response.data as Record<string, unknown>;
        const dataMessage = (responseData && typeof responseData === 'object' && 'data' in responseData)
            ? responseData['data'] as Record<string, unknown> | undefined
            : undefined;

        const rawRole = (dataMessage && typeof dataMessage === 'object' && 'role' in dataMessage && typeof dataMessage['role'] === 'string')
            ? dataMessage['role']
            : 'assistant';
        // The server response always returns an assistant message role
        const role = (rawRole === 'user' || rawRole === 'assistant' || rawRole === 'system' || rawRole === 'tool')
            ? rawRole
            : 'assistant' as const;

        const content = (dataMessage && typeof dataMessage === 'object' && 'content' in dataMessage && typeof dataMessage['content'] === 'string')
            ? dataMessage['content']
            : extractContent(response);

        const assistantMessage: IChatRequestMessage = {
            role,
            content
        };

        // Preserve toolCalls when available (array of tool call fragments)
        if (dataMessage && typeof dataMessage === 'object' && 'toolCalls' in dataMessage) {
            const tc = dataMessage['toolCalls'];
            if (Array.isArray(tc)) {
                assistantMessage.toolCalls = tc as IToolCall[];
            }
        }

        const providerName = (responseData && typeof responseData === 'object' && 'provider' in responseData && typeof responseData['provider'] === 'string')
            ? responseData['provider']
            : undefined;
        const modelName = (responseData && typeof responseData === 'object' && 'model' in responseData && typeof responseData['model'] === 'string')
            ? responseData['model']
            : undefined;

        return toResponseMessage(
            assistantMessage,
            providerName,
            modelName
        );
    }

    /**
     * Execute streaming chat request
     */
    async *chatStream(messages: IBasicMessage[], provider: string, model: string, tools?: IToolSchema[]): AsyncGenerator<IResponseMessage> {
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
                                const parsed = JSON.parse(data) as Record<string, unknown>;

                                // The server sends the raw TUniversalMessage; no unwrapping is needed.
                                const responseData = parsed;

                                if (responseData && responseData['role'] === 'assistant') {
                                    const contentValue = typeof responseData['content'] === 'string' ? responseData['content'] : '';
                                    const toolCalls = responseData['toolCalls'];

                                    // Debug: inspect parsed data
                                    this.logger.debug('🔍 [HTTP-CLIENT-PARSE] Parsed response data:', {
                                        role: String(responseData['role']),
                                        content: contentValue.substring(0, 30) + '...',
                                        hasToolCalls: !!toolCalls,
                                        toolCallsLength: Array.isArray(toolCalls) ? toolCalls.length : 0
                                    });

                                    yield toResponseMessage(
                                        {
                                            role: 'assistant',
                                            content: contentValue,
                                            // Always forward toolCalls when present (including empty id fragments)
                                            ...(Array.isArray(toolCalls) &&
                                                { toolCalls: toolCalls as IToolCall[] })
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
