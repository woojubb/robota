import { BaseExecutor } from '@robota-sdk/agents';
import type {
    ChatExecutionRequest,
    StreamExecutionRequest,
    RemoteExecutorConfig,
    UniversalMessage,
    AssistantMessage
} from '../shared/types';
import { AIProviderEngine } from '../core/ai-provider-engine';
import { HttpTransport } from '../transport/http-transport';
import type { Transport } from '../transport/transport-interface';

/**
 * RemoteExecutor - Client implementation
 * Combines core business logic with transport layer
 */
export class RemoteExecutor extends BaseExecutor {
    readonly name = 'remote';
    readonly version = '1.0.0';

    private engine: AIProviderEngine;
    private transport: Transport;
    private config: Required<RemoteExecutorConfig>;

    constructor(config: RemoteExecutorConfig) {
        super();

        this.config = {
            serverUrl: config.serverUrl,
            userApiKey: config.userApiKey,
            timeout: config.timeout || 30000,
            maxRetries: config.maxRetries || 3,
            enableWebSocket: config.enableWebSocket || false,
            headers: config.headers || {},
            ...config
        };

        // Initialize core engine
        this.engine = new AIProviderEngine();

        // Initialize transport layer
        this.transport = new HttpTransport({
            baseUrl: this.config.serverUrl,
            timeout: this.config.timeout,
            retryCount: this.config.retryCount,
            headers: {
                ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
            }
        });
    }

    override async executeChat(request: ChatExecutionRequest): Promise<AssistantMessage> {
        // 1. Validate using core engine
        this.engine.validateRequest(request);

        // 2. Transform request using core engine
        const transportRequest = {
            id: `chat_${Date.now()}`,
            url: '/v1/remote/chat',
            method: 'POST' as const,
            headers: {
                'Content-Type': 'application/json'
            },
            body: this.engine.transformRequest(request)
        };

        // 3. Send via transport with retry logic
        const response = await this.withRetry(async () => {
            return this.transport.send(transportRequest);
        });

        // 4. Validate and transform response using core engine
        return this.engine.validateResponse(response.data);
    }

    override async *executeChatStream(request: StreamExecutionRequest): AsyncIterable<UniversalMessage> {
        // 1. Validate using core engine
        this.engine.validateStreamRequest(request);

        // 2. Transform request using core engine
        const transportRequest = {
            id: `stream_${Date.now()}`,
            url: '/v1/remote/stream',
            method: 'POST' as const,
            headers: {
                'Content-Type': 'application/json'
            },
            body: this.engine.transformStreamRequest(request)
        };

        // 3. Stream via transport
        try {
            for await (const chunk of this.transport.sendStream(transportRequest)) {
                // 4. Validate each chunk using core engine
                yield this.engine.validateStreamChunk(chunk);
            }
        } catch (error) {
            this.logError('Stream execution failed', error as Error);
            throw error;
        }
    }

    override supportsTools(): boolean {
        return true;
    }

    override validateConfig(): boolean {
        try {
            if (!this.config.serverUrl) {
                throw new Error('serverUrl is required');
            }

            new URL(this.config.serverUrl); // Validate URL format
            return true;
        } catch (error) {
            this.logError('Invalid configuration', error as Error);
            return false;
        }
    }

    override async dispose(): Promise<void> {
        try {
            await this.transport.disconnect();
            this.logDebug('RemoteExecutor disposed successfully');
        } catch (error) {
            this.logError('Error disposing RemoteExecutor', error as Error);
        }
    }

    /**
     * Test connection to remote server
     */
    async healthCheck(): Promise<boolean> {
        try {
            await this.transport.connect();
            return true;
        } catch (error) {
            this.logError('Health check failed', error as Error);
            return false;
        }
    }

    /**
     * Get provider capabilities from server
     */
    async getProviderCapabilities(provider: string) {
        return this.engine.getProviderCapabilities(provider);
    }
} 