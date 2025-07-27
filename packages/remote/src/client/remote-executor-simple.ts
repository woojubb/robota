/**
 * Simple RemoteExecutor - Composed from Atomic Components
 * 
 * Facade pattern using pure functions and atomic types
 */

import type { BasicMessage } from '../types/message-types';
import type {
    UniversalMessage,
    AssistantMessage,
    StreamExecutionRequest,
    ChatExecutionRequest,
    ExecutorInterface,
    SimpleLogger,
    ToolCall
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
 * Implements ExecutorInterface for full compatibility with LocalExecutor
 */
export class SimpleRemoteExecutor implements ExecutorInterface {
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
     * Execute chat request (ExecutorInterface compatible)
     */
    async executeChat(request: ChatExecutionRequest): Promise<AssistantMessage> {
        this.logger.debug('SimpleRemoteExecutor.executeChat called', {
            hasTools: !!request.tools,
            toolsCount: request.tools?.length || 0
        });

        this.logger.debug('Using ExecutorInterface format (non-streaming)');
        const messages = request.messages;
        const provider = request.provider;
        const model = request.model;

        const response = await this.httpClient.chat(messages, provider, model, request.tools);

        // Convert ResponseMessage to AssistantMessage (ExecutorInterface requirement)
        const assistantMessage: AssistantMessage = {
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
    async *executeChatStream(request: StreamExecutionRequest): AsyncIterable<UniversalMessage> {
        this.logger.debug('🔍 [REMOTE-EXECUTOR] executeChatStream called');

        try {
            const stream = this.httpClient.chatStream(
                request.messages,
                request.provider,
                request.model,
                request.tools
            );

            // ✅ LocalExecutor와 완전히 동일: 모든 청크를 그대로 yield (ExecutionService가 병합 처리)
            for await (const responseMessage of stream) {
                // Convert ResponseMessage to UniversalMessage (LocalExecutor와 동일한 형태)
                const universalMessage: UniversalMessage = {
                    role: responseMessage.role as 'assistant',
                    content: responseMessage.content,
                    timestamp: responseMessage.timestamp,
                    ...(responseMessage.toolCalls && { toolCalls: responseMessage.toolCalls })
                };

                // LocalExecutor처럼 모든 청크를 그대로 yield
                yield universalMessage;
            }

        } catch (error) {
            this.logger.error('Error in executeChatStream:', error);
            throw error;
        }
    }

    /**
     * Check if the executor supports tool calling (ExecutorInterface requirement)
     */
    supportsTools(): boolean {
        return true;
    }

    /**
     * Validate executor configuration (ExecutorInterface requirement)
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
     * Clean up resources (ExecutorInterface requirement)
     */
    async dispose(): Promise<void> {
        // Cleanup any resources if needed
        this.logger.debug('SimpleRemoteExecutor disposed');
    }
} 