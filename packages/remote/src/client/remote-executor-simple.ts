/**
 * Simple RemoteExecutor - Composed from Atomic Components
 * 
 * Facade pattern using pure functions and atomic types
 */

import type { BasicMessage, ResponseMessage } from '../types/message-types';
import { HttpClientFacade, type HttpClientConfig } from './http-client-facade';
import { isString } from '../utils/type-guards';

export interface SimpleRemoteConfig {
    serverUrl: string;
    userApiKey: string;
    timeout?: number;
    headers?: Record<string, string>;
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
    readonly name = 'simple-remote';
    readonly version = '1.0.0';

    private httpClient: HttpClientFacade;
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

        this.httpClient = new HttpClientFacade(httpConfig);
    }

    /**
     * Execute chat request
     */
    async executeChat(request: SimpleExecutionRequest): Promise<ResponseMessage> {
        this.validateExecutionRequest(request);

        return await this.httpClient.chat(
            request.messages,
            request.provider,
            request.model
        );
    }

    /**
     * Execute streaming chat request (simplified)
     */
    async *executeChatStream(request: SimpleExecutionRequest): AsyncGenerator<ResponseMessage> {
        // For now, yield single response (can be enhanced later)
        const response = await this.executeChat(request);
        yield response;
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
            isString(configToValidate.serverUrl) &&
            configToValidate.serverUrl.length > 0 &&
            isString(configToValidate.userApiKey) &&
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

        if (!isString(request.provider) || request.provider.length === 0) {
            throw new Error('Provider is required');
        }

        if (!isString(request.model) || request.model.length === 0) {
            throw new Error('Model is required');
        }

        // Validate each message
        for (let i = 0; i < request.messages.length; i++) {
            const message = request.messages[i];
            if (!isString(message.role) || !isString(message.content)) {
                throw new Error(`Invalid message at index ${i}: role and content must be strings`);
            }
        }
    }

    /**
     * Clean up resources
     */
    async dispose(): Promise<void> {
        // Nothing to clean up in this simple implementation
    }
} 