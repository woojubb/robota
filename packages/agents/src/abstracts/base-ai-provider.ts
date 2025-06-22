import type { AIProvider, Context, ModelResponse, StreamingResponseChunk, ToolSchema } from '../interfaces/provider';
import type { UniversalMessage } from '../managers/conversation-history-manager';
import { BaseProvider } from './base-provider';
import { logger } from '../utils/logger';

/**
 * Configuration for provider execution
 */
export interface ProviderExecutionConfig {
    model: string;
    systemMessage?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: ToolSchema[];
    metadata?: Record<string, any>;
}

/**
 * Result from provider execution
 */
export interface ProviderExecutionResult {
    content: string;
    toolCalls?: any[];
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
    finishReason?: string;
    metadata?: Record<string, any>;
}

/**
 * Base abstract class for AI providers
 */
export abstract class BaseAIProvider extends BaseProvider implements AIProvider {
    abstract readonly models: string[];

    abstract chat(model: string, context: Context, options?: any): Promise<ModelResponse>;

    chatStream?(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown>;

    /**
     * High-level execute method that handles the entire conversation process
     * 
     * This method encapsulates all provider-specific logic including:
     * - Message format conversion
     * - Tool configuration
     * - Request preparation
     * - Response processing
     * 
     * ExecutionService delegates the entire AI interaction to this method.
     * 
     * @param messages - Array of UniversalMessage from conversation history
     * @param config - Execution configuration
     * @returns Provider execution result
     */
    async execute(messages: UniversalMessage[], config: ProviderExecutionConfig): Promise<ProviderExecutionResult> {
        try {
            // Convert messages to provider-specific format
            const convertedMessages = this.convertMessages(messages);



            // Prepare context with all configuration
            const context: Context = {
                messages: convertedMessages,
                systemMessage: config.systemMessage,
                temperature: config.temperature,
                maxTokens: config.maxTokens,
                tools: config.tools,  // Pass original ToolSchema[] to context
                metadata: config.metadata
            };

            // Generate response using provider's chat method
            const response = await this.chat(config.model, context);

            // Process and return standardized result
            return this.processResponse(response);

        } catch (error) {
            this.handleApiError(error, 'execute');
        }
    }

    /**
     * High-level streaming execute method
     * 
     * @param messages - Array of UniversalMessage from conversation history
     * @param config - Execution configuration
     * @returns Async generator of streaming results
     */
    async* executeStream(messages: UniversalMessage[], config: ProviderExecutionConfig): AsyncGenerator<ProviderExecutionResult, void, unknown> {
        if (!this.chatStream) {
            throw new Error(`Streaming not supported by ${this.name} provider`);
        }

        try {
            // Convert messages to provider-specific format
            const convertedMessages = this.convertMessages(messages);

            // Prepare context with all configuration
            const context: Context = {
                messages: convertedMessages,
                systemMessage: config.systemMessage,
                temperature: config.temperature,
                maxTokens: config.maxTokens,
                tools: config.tools,  // Pass original ToolSchema[] to context
                metadata: config.metadata
            };

            // Generate streaming response
            for await (const chunk of this.chatStream(config.model, context)) {
                yield this.processStreamingChunk(chunk);
            }

        } catch (error) {
            this.handleApiError(error, 'executeStream');
        }
    }

    /**
     * Generate response using raw request payload (default implementation uses chat)
     */
    async generateResponse(request: any): Promise<any> {
        return this.chat(request.model, { messages: request.messages }, request);
    }

    /**
     * Generate streaming response using raw request payload (default implementation uses chatStream)
     */
    async* generateStreamingResponse?(request: any): AsyncGenerator<any, void, unknown> {
        if (this.chatStream) {
            yield* this.chatStream(request.model, { messages: request.messages }, request);
        } else {
            throw new Error('Streaming not supported by this provider');
        }
    }

    supportsModel(model: string): boolean {
        return this.models.includes(model);
    }

    async close?(): Promise<void> {
        await this.dispose();
    }

    /**
     * Validate context parameter
     */
    protected validateContext(context: Context): void {
        if (!context || typeof context !== 'object') {
            logger.error(`[${this.name}] Invalid context:`, context);
            throw new Error('Valid Context object is required');
        }

        const { messages } = context;

        if (!Array.isArray(messages)) {
            logger.error(`[${this.name}] Invalid message array:`, messages);
            throw new Error('Valid message array is required');
        }
    }

    /**
     * Handle API errors with provider-specific context
     */
    protected handleApiError(error: any, operation: string): never {
        logger.error(`[${this.name}] ${operation} API call error:`, error);

        if (error.code === 'insufficient_quota') {
            throw new Error(`${this.name} API quota exceeded. Please check your plan and billing details.`);
        }

        if (error.code === 'invalid_api_key') {
            throw new Error(`${this.name} API key is invalid. Please check your API key.`);
        }

        if (error.code === 'rate_limit_exceeded') {
            throw new Error(`${this.name} API rate limit exceeded. Please try again later.`);
        }

        // Generic error handling
        const message = error.message || error.error?.message || 'Unknown API error';
        throw new Error(`${this.name} API error: ${message}`);
    }

    /**
     * Convert UniversalMessage[] to provider-specific message format
     * 
     * Each provider MUST implement this method to convert UniversalMessage[]
     * to their own API's message format.
     * 
     * @param messages - Array of UniversalMessage to convert
     * @returns Provider-specific message format
     */
    protected abstract convertMessages(messages: UniversalMessage[]): any[];

    /**
     * Configure tools for the API request
     * 
     * Each provider can override this to implement provider-specific tool configuration.
     * By default, returns undefined (no tools).
     * 
     * @param tools - Array of tool schemas
     * @returns Provider-specific tool configuration or undefined
     */
    protected configureTools(_tools?: ToolSchema[]): any {
        return undefined;
    }

    /**
     * Process provider response into standardized format
     * 
     * Each provider can override this to implement provider-specific response processing.
     * 
     * @param response - Raw response from provider's chat method
     * @returns Standardized ProviderExecutionResult
     */
    protected processResponse(response: ModelResponse): ProviderExecutionResult {
        return {
            content: response.content || '',
            toolCalls: (response as any).toolCalls,
            usage: (response as any).usage,
            finishReason: (response as any).finishReason,
            metadata: (response as any).metadata
        };
    }

    /**
     * Process streaming chunk into standardized format
     * 
     * Each provider can override this to implement provider-specific chunk processing.
     * 
     * @param chunk - Raw streaming chunk from provider
     * @returns Standardized ProviderExecutionResult for the chunk
     */
    protected processStreamingChunk(chunk: StreamingResponseChunk): ProviderExecutionResult {
        return {
            content: chunk.content || '',
            toolCalls: (chunk as any).toolCalls,
            usage: (chunk as any).usage,
            finishReason: (chunk as any).finishReason,
            metadata: (chunk as any).metadata
        };
    }
} 