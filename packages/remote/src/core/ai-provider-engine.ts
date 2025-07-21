import type {
    ChatExecutionRequest,
    StreamExecutionRequest,
    UniversalMessage,
    AssistantMessage
} from '../shared/types';

/**
 * AI Provider Engine
 * Core business logic for processing AI requests
 * Used by both client and server components
 */
export class AIProviderEngine {
    /**
     * Validate incoming chat execution request
     */
    validateRequest(request: ChatExecutionRequest): void {
        if (!request.provider) {
            throw new Error('Provider is required');
        }

        if (!request.messages || request.messages.length === 0) {
            throw new Error('Messages array cannot be empty');
        }

        if (!Array.isArray(request.messages)) {
            throw new Error('Messages must be an array');
        }

        // Validate message format
        for (const message of request.messages) {
            if (!message.role || !message.content) {
                throw new Error('Each message must have role and content');
            }

            if (!['system', 'user', 'assistant', 'tool'].includes(message.role)) {
                throw new Error(`Invalid message role: ${message.role}`);
            }
        }

        // Validate options if provided
        if (request.options) {
            if (request.options.maxTokens && request.options.maxTokens <= 0) {
                throw new Error('maxTokens must be positive');
            }

            if (request.options.temperature && (request.options.temperature < 0 || request.options.temperature > 2)) {
                throw new Error('temperature must be between 0 and 2');
            }
        }
    }

    /**
 * Validate streaming request
 */
    validateStreamRequest(request: StreamExecutionRequest): void {
        this.validateRequest(request);
        // StreamExecutionRequest extends ChatExecutionRequest, no additional validation needed
    }

    /**
     * Transform request for transport
     */
    transformRequest(request: ChatExecutionRequest): any {
        return {
            provider: request.provider,
            messages: request.messages,
            options: {
                maxTokens: request.options?.maxTokens,
                temperature: request.options?.temperature,
                tools: request.options?.tools,
                stream: false
            },
            timestamp: new Date().toISOString(),
            requestId: this.generateRequestId()
        };
    }

    /**
     * Transform streaming request for transport
     */
    transformStreamRequest(request: StreamExecutionRequest): any {
        return {
            ...this.transformRequest(request),
            options: {
                ...this.transformRequest(request).options,
                stream: true
            }
        };
    }

    /**
     * Validate and transform response
     */
    validateResponse(response: any): AssistantMessage {
        if (!response) {
            throw new Error('Response cannot be null or undefined');
        }

        if (!response.role || response.role !== 'assistant') {
            throw new Error('Response must have role "assistant"');
        }

        if (!response.content) {
            throw new Error('Response must have content');
        }

        return {
            role: 'assistant',
            content: response.content,
            timestamp: response.timestamp || new Date(),
            toolCalls: response.toolCalls,
            metadata: {
                model: response.model,
                usage: response.usage
            }
        };
    }

    /**
     * Validate streaming chunk
     */
    validateStreamChunk(chunk: any): UniversalMessage {
        if (!chunk) {
            throw new Error('Chunk cannot be null or undefined');
        }

        if (!chunk.role) {
            throw new Error('Chunk must have a role');
        }

        return {
            role: chunk.role,
            content: chunk.content || '',
            timestamp: chunk.timestamp || new Date(),
            ...(chunk.toolCalls && { toolCalls: chunk.toolCalls }),
            metadata: {
                model: chunk.model,
                usage: chunk.usage
            }
        } as UniversalMessage;
    }

    /**
     * Extract provider capabilities
     */
    getProviderCapabilities(provider: string): ProviderCapabilities {
        switch (provider.toLowerCase()) {
            case 'openai':
                return {
                    streaming: true,
                    tools: true,
                    maxTokens: 128000,
                    models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo']
                };

            case 'anthropic':
                return {
                    streaming: true,
                    tools: true,
                    maxTokens: 200000,
                    models: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku']
                };

            case 'google':
                return {
                    streaming: true,
                    tools: true,
                    maxTokens: 32000,
                    models: ['gemini-pro', 'gemini-pro-vision']
                };

            default:
                throw new Error(`Unknown provider: ${provider}`);
        }
    }

    /**
     * Calculate request priority based on user context and request type
     */
    calculatePriority(request: ChatExecutionRequest, userContext?: any): number {
        let priority = 5; // Default priority (1-10, 10 is highest)

        // Adjust based on request complexity
        if (request.options?.tools && request.options.tools.length > 0) {
            priority += 1; // Tool calls get higher priority
        }

        if (request.messages.length > 10) {
            priority -= 1; // Long conversations get lower priority
        }

        // Adjust based on user context
        if (userContext?.tier === 'premium') {
            priority += 2;
        }

        return Math.max(1, Math.min(10, priority));
    }

    /**
     * Generate unique request ID
     */
    private generateRequestId(): string {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

/**
 * Provider capabilities interface
 */
export interface ProviderCapabilities {
    streaming: boolean;
    tools: boolean;
    maxTokens: number;
    models: string[];
} 