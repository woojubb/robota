/**
 * Simple RemoteExecutor - Composed from Atomic Components
 * 
 * Facade pattern using pure functions and atomic types
 */

import type { IBasicMessage } from '../types/message-types';
import type {
    TUniversalMessage,
    IAssistantMessage,
    IStreamExecutionRequest,
    IChatExecutionRequest,
    IExecutor,
    ILogger,
} from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';
import { HttpClient, type IHttpClientConfig } from './http-client';
// Simple inline type checking instead of external type guards

function validateChatExecutionRequest(request: IChatExecutionRequest | IStreamExecutionRequest): void {
    if (!request.messages || request.messages.length === 0) {
        throw new Error('Messages array is required and cannot be empty');
    }

    if (!request.provider) {
        throw new Error('Provider is required');
    }

    if (!request.model) {
        throw new Error('Model is required');
    }

    for (let i = 0; i < request.messages.length; i++) {
        const msg = request.messages[i];
        if (typeof msg.role !== 'string' || typeof msg.content !== 'string') {
            throw new Error(`Invalid message at index ${i}: role and content must be strings`);
        }
    }
}

export interface ISimpleRemoteConfig {
    serverUrl: string;
    userApiKey: string;
    timeout?: number;
    headers?: Record<string, string>;
    /** Enable WebSocket for real-time communication */
    enableWebSocket?: boolean;
    /** WebSocket endpoint path (defaults to /ws/playground) */
    websocketPath?: string;
    /** Auto-reconnect WebSocket on disconnect */
    autoReconnect?: boolean;
    /** Logger instance for dependency injection */
    logger?: ILogger;
}

export interface ISimpleExecutionRequest {
    messages: IBasicMessage[];
    provider: string;
    model: string;
}

/**
 * Simple RemoteExecutor using atomic components
 * Implements IExecutor for full compatibility with LocalExecutor
 */
export class SimpleRemoteExecutor implements IExecutor {
    readonly name = 'remote';
    readonly version = '1.0.0';

    private readonly httpClient: HttpClient;
    private readonly logger: ILogger;
    private readonly config: ISimpleRemoteConfig;

    constructor(config: ISimpleRemoteConfig) {
        this.config = config;
        // Validate configuration
        this.validateConfig();

        // Initialize logger with dependency injection pattern
        this.logger = config.logger || SilentLogger;

        // Create HTTP client with timeout and headers
        const httpConfig: IHttpClientConfig = {
            baseUrl: config.serverUrl,
            timeout: config.timeout || 30000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.userApiKey}`,
                ...config.headers
            },
            logger: this.logger
        };

        this.httpClient = new HttpClient(httpConfig);
    }

    /**
     * Execute chat request (IExecutor compatible)
     */
    async executeChat(request: IChatExecutionRequest): Promise<IAssistantMessage> {
        validateChatExecutionRequest(request);

        this.logger.debug('SimpleRemoteExecutor.executeChat called', {
            hasTools: !!request.tools,
            toolsCount: request.tools?.length || 0
        });

        this.logger.debug('Using IExecutor format (non-streaming)');
        const messages = request.messages;
        const provider = request.provider;
        const model = request.model;

        const response = await this.httpClient.chat(messages, provider, model, request.tools);

        // Convert IResponseMessage to IAssistantMessage (IExecutor requirement)
        const assistantMessage: IAssistantMessage = {
            role: 'assistant',
            content: response.content || '',
            timestamp: new Date()
        };

        if (response.toolCalls) {
            assistantMessage.toolCalls = response.toolCalls;
        }

        return assistantMessage;
    }

    /**
     * Execute streaming chat completion
     */
    async *executeChatStream(request: IStreamExecutionRequest): AsyncIterable<TUniversalMessage> {
        validateChatExecutionRequest(request);

        this.logger.debug('[REMOTE-EXECUTOR] executeChatStream called');

        // RemoteExecutor.executeChatStream() - Request with tools
        this.logger.debug('[TOOL-FLOW] RemoteExecutor.executeChatStream() - Sending to server', {
            provider: request.provider,
            model: request.model,
            hasTools: !!request.tools,
            toolsCount: request.tools?.length || 0,
            toolNames: request.tools?.map(t => t.name) || []
        });

        try {
            const stream = this.httpClient.chatStream(
                request.messages,
                request.provider,
                request.model,
                request.tools
            );

            // LocalExecutor-compatible: yield every chunk as-is (ExecutionService merges them).
            for await (const responseMessage of stream) {
                // Convert IResponseMessage to TUniversalMessage (LocalExecutor-compatible shape)
                const universalMessage: TUniversalMessage = {
                    role: responseMessage.role as 'assistant',
                    content: responseMessage.content,
                    timestamp: responseMessage.timestamp,
                    ...(responseMessage.toolCalls && { toolCalls: responseMessage.toolCalls })
                };

                // Yield every chunk (no buffering)
                yield universalMessage;
            }

        } catch (error) {
            this.logger.error('Error in executeChatStream', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Check if the executor supports tool calling (IExecutor requirement)
     */
    supportsTools(): boolean {
        return true;
    }

    /**
     * Validate executor configuration (IExecutor requirement)
     */
    validateConfig(): boolean {
        if (!this.config.serverUrl) {
            throw new Error('BaseURL is required but not provided');
        }
        if (!this.config.userApiKey) {
            throw new Error('User API key is required but not provided');
        }
        return true;
    }

    /**
     * Clean up resources (IExecutor requirement)
     */
    async dispose(): Promise<void> {
        // Cleanup any resources if needed
        this.logger.debug('SimpleRemoteExecutor disposed');
    }
} 