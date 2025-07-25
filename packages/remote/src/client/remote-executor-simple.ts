/**
 * Simple RemoteExecutor - Composed from Atomic Components
 * 
 * Facade pattern using pure functions and atomic types
 */

import type { BasicMessage, ResponseMessage } from '../types/message-types';
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
}

export interface SimpleExecutionRequest {
    messages: BasicMessage[];
    provider: string;
    model: string;
}

/**
 * Simple RemoteExecutor using atomic components
 */
export class SimpleRemoteExecutor {
    readonly name = 'SimpleRemoteExecutor';
    readonly version = '1.0.0';

    private httpClient: HttpClient;
    private config: SimpleRemoteConfig;

    constructor(config: SimpleRemoteConfig) {
        if (!this.validateConfig(config)) {
            throw new Error('Invalid configuration provided');
        }

        this.config = config;

        const httpConfig: HttpClientConfig = {
            baseUrl: config.serverUrl,
            timeout: config.timeout || 30000,
            headers: {
                'Authorization': `Bearer ${config.userApiKey}`,
                ...config.headers
            }
        };

        this.httpClient = new HttpClient(httpConfig);
    }

    /**
     * Execute chat request (supports both SimpleExecutionRequest and ChatExecutionRequest)
     */
    async executeChat(request: SimpleExecutionRequest | any): Promise<ResponseMessage | any> {
        console.log('SimpleRemoteExecutor.executeChat called with request:', request);

        // Handle different request types
        let messages: BasicMessage[];
        let provider: string;
        let model: string;

        if ('options' in request && request.options) {
            // ExecutorInterface format (ChatExecutionRequest)
            console.log('Using ExecutorInterface format (non-streaming)');
            messages = request.messages;
            provider = request.provider;
            model = request.model;

            const response = await this.httpClient.chat(messages, provider, model);

            return {
                role: 'assistant',
                content: response.content,
                timestamp: new Date()
            };
        } else {
            // Legacy SimpleExecutionRequest format
            console.log('Using legacy SimpleExecutionRequest format');
            this.validateExecutionRequest(request as SimpleExecutionRequest);

            return await this.httpClient.chat(
                request.messages,
                request.provider,
                request.model
            );
        }
    }

    /**
     * Execute streaming chat request (supports both SimpleExecutionRequest and ChatExecutionRequest)
     */
    async *executeChatStream(request: SimpleExecutionRequest | any): AsyncGenerator<ResponseMessage | any> {
        console.log('SimpleRemoteExecutor.executeChatStream called with request:', request);

        // Handle different request types
        let messages: BasicMessage[];
        let provider: string;
        let model: string;

        if ('stream' in request && request.stream === true) {
            // ExecutorInterface format (StreamExecutionRequest)
            console.log('Using ExecutorInterface format (streaming)');
            messages = request.messages;
            provider = request.provider;
            model = request.model;

            for await (const response of this.httpClient.chatStream(messages, provider, model)) {
                yield {
                    role: 'assistant',
                    content: response.content,
                    timestamp: new Date()
                };
            }
        } else {
            // Legacy SimpleExecutionRequest format
            console.log('Using legacy SimpleExecutionRequest format');
            this.validateExecutionRequest(request as SimpleExecutionRequest);

            const simpleRequest = request as SimpleExecutionRequest;
            yield* this.httpClient.chatStream(
                simpleRequest.messages,
                simpleRequest.provider,
                simpleRequest.model
            );
        }
    }

    /**
     * ExecutorInterface-compatible executeChat method
     */
    async executeChatCompat(request: any): Promise<any> {
        console.log('SimpleRemoteExecutor.executeChatCompat called');

        const simpleRequest: SimpleExecutionRequest = {
            messages: request.messages,
            provider: request.provider,
            model: request.model
        };

        const response = await this.executeChat(simpleRequest);

        return {
            role: 'assistant',
            content: response.content,
            timestamp: new Date()
        };
    }

    /**
     * ExecutorInterface-compatible executeChatStream method
     */
    async *executeChatStreamCompat(request: any): AsyncGenerator<any> {
        console.log('SimpleRemoteExecutor.executeChatStreamCompat called');

        const simpleRequest: SimpleExecutionRequest = {
            messages: request.messages,
            provider: request.provider,
            model: request.model
        };

        for await (const response of this.executeChatStream(simpleRequest)) {
            yield {
                role: 'assistant',
                content: response.content,
                timestamp: new Date()
            };
        }
    }

    /**
     * Check if tools are supported
     */
    supportsTools(): boolean {
        return true;
    }

    /**
     * Validate configuration
     */
    validateConfig(config?: SimpleRemoteConfig): boolean {
        const configToValidate = config || this.config;

        return (
            typeof configToValidate.serverUrl === 'string' &&
            configToValidate.serverUrl.length > 0 &&
            typeof configToValidate.userApiKey === 'string' &&
            configToValidate.userApiKey.length > 0
        );
    }

    /**
     * Validate execution request
     */
    private validateExecutionRequest(request: SimpleExecutionRequest): void {
        if (!Array.isArray(request.messages) || request.messages.length === 0) {
            throw new Error('Messages array is required and cannot be empty');
        }

        if (typeof request.provider !== 'string' || request.provider.length === 0) {
            throw new Error('Provider is required');
        }

        if (typeof request.model !== 'string' || request.model.length === 0) {
            throw new Error('Model is required');
        }

        // Validate each message
        for (let i = 0; i < request.messages.length; i++) {
            const message = request.messages[i];
            if (!message || typeof message.role !== 'string' || typeof message.content !== 'string') {
                throw new Error(`Invalid message at index ${i}: role and content must be strings`);
            }
        }
    }

    /**
     * Clean up resources
     */
    async dispose(): Promise<void> {
        // Clean up HTTP client if needed
    }
} 