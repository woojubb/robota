/**
 * Simple RemoteExecutor - Composed from Atomic Components
 * 
 * Facade pattern using pure functions and atomic types
 */

import type { BasicMessage } from '../types/message-types';
import type {
    TUniversalMessage,
    IAssistantMessage,
    IStreamExecutionRequest,
    IChatExecutionRequest,
    IExecutor,
    SimpleLogger,
} from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';
import { HttpClient, type HttpClientConfig } from './http-client';
// Simple inline type checking instead of external type guards

export interface SimpleRemoteConfig {
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
    logger?: SimpleLogger;
}

export interface SimpleExecutionRequest {
    messages: BasicMessage[];
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
    private readonly logger: SimpleLogger;
    private readonly config: SimpleRemoteConfig;

    constructor(config: SimpleRemoteConfig) {
        this.config = config;
        // Validate configuration
        this.validateConfig();

        // Initialize logger with dependency injection pattern
        this.logger = config.logger || SilentLogger;

        // Create HTTP client with timeout and headers
        const httpConfig: HttpClientConfig = {
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
        this.logger.debug('SimpleRemoteExecutor.executeChat called', {
            hasTools: !!request.tools,
            toolsCount: request.tools?.length || 0
        });

        this.logger.debug('Using IExecutor format (non-streaming)');
        const messages = request.messages;
        const provider = request.provider;
        const model = request.model;

        const response = await this.httpClient.chat(messages, provider, model, request.tools);

        // Convert ResponseMessage to AssistantMessage (IExecutor requirement)
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
                // Convert ResponseMessage to TUniversalMessage (LocalExecutor-compatible shape)
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
            this.logger.error?.('Error in executeChatStream', { error });
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