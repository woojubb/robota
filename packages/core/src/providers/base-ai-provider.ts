import {
    Context,
    ModelResponse,
    StreamingResponseChunk,
    AIProvider
} from '../interfaces/ai-provider';
import type { FunctionSchema } from '@robota-sdk/tools';
import { logger } from '../index';

/**
 * Base abstract class for AI providers
 * 
 * Provides common functionality and standardized interfaces for all AI providers.
 * Handles tool calling support, message filtering, and response parsing.
 */
export abstract class BaseAIProvider implements AIProvider {
    /**
     * Provider identifier name
     */
    public abstract readonly name: string;

    /**
     * Provider configuration options
     */
    public abstract readonly options: any;

    /**
     * Send a chat request and receive a complete response
     */
    public abstract chat(model: string, context: Context, options?: any): Promise<ModelResponse>;

    /**
     * Send a streaming chat request and receive response chunks
     */
    public abstract chatStream(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown>;

    /**
     * Close the provider and clean up resources
     */
    public abstract close(): Promise<void>;

    /**
 * Configure tools for the API request
 * 
 * Each provider can override this to implement provider-specific tool configuration.
 * By default, returns undefined (no tools).
 * 
 * @param tools - Array of function schemas
 * @returns Provider-specific tool configuration or undefined
 */
    protected configureTools(_tools?: FunctionSchema[]): any {
        return undefined;
    }

    /**
     * Validate context object
     * 
     * Common validation logic for all providers.
     * 
     * @param context - Context object to validate
     * @throws {Error} When context is invalid
     */
    protected validateContext(context: Context): void {
        if (!context || typeof context !== 'object') {
            logger.error(`[${this.name}Provider] Invalid context:`, context);
            throw new Error('Valid Context object is required');
        }

        const { messages } = context;

        if (!Array.isArray(messages)) {
            logger.error(`[${this.name}Provider] Invalid message array:`, messages);
            throw new Error('Valid message array is required');
        }
    }

    /**
     * Handle API errors with consistent error formatting
     * 
     * @param error - Original error from API call
     * @param operation - Operation that failed (e.g., 'chat', 'chatStream')
     * @throws {Error} Formatted error with provider context
     */
    protected handleApiError(error: any, operation: string): never {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[${this.name}Provider] ${operation} error:`, error);
        throw new Error(`${this.name} API ${operation} error: ${errorMessage}`);
    }
} 