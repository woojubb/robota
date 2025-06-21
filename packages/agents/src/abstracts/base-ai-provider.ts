import type { AIProvider, Context, ModelResponse, StreamingResponseChunk, ToolSchema } from '../interfaces/provider';
import { BaseProvider } from './base-provider';
import { logger } from '../utils/logger';

/**
 * Base abstract class for AI providers
 */
export abstract class BaseAIProvider extends BaseProvider implements AIProvider {
    abstract readonly models: string[];

    abstract chat(model: string, context: Context, options?: any): Promise<ModelResponse>;

    chatStream?(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown>;

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
} 