/**
 * Service layer interfaces for the agents package
 * Defines contracts for stateless service implementations
 */

import { Message } from './agent';
import { AIProvider } from './provider';

/**
 * Conversation context containing messages and metadata
 */
export interface ConversationContext {
    /** All messages in the conversation */
    messages: Message[];
    /** System message for the conversation */
    systemMessage?: string;
    /** Model to use for generation */
    model: string;
    /** Provider to use for generation */
    provider: string;
    /** Temperature for generation */
    temperature?: number;
    /** Maximum tokens to generate */
    maxTokens?: number;
    /** Available tools */
    tools?: any[];
    /** Additional metadata */
    metadata?: Record<string, any>;
}

/**
 * Response from AI provider
 */
export interface ConversationResponse {
    /** Generated content */
    content: string;
    /** Tool calls if any */
    toolCalls?: any[];
    /** Usage statistics */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    /** Response metadata */
    metadata?: Record<string, any>;
    /** Finish reason */
    finishReason?: string;
}

/**
 * Streaming response chunk
 */
export interface StreamingChunk {
    /** Content delta */
    delta: string;
    /** Whether this is the final chunk */
    done: boolean;
    /** Tool calls if any */
    toolCalls?: any[];
    /** Usage statistics (only in final chunk) */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

/**
 * Service options for conversation operations
 */
export interface ConversationServiceOptions {
    /** Maximum conversation history length */
    maxHistoryLength?: number;
    /** Whether to automatically retry on failure */
    enableRetry?: boolean;
    /** Maximum number of retries */
    maxRetries?: number;
    /** Retry delay in milliseconds */
    retryDelay?: number;
    /** Request timeout in milliseconds */
    timeout?: number;
}

/**
 * Context options for conversation preparation
 */
export interface ContextOptions {
    systemMessage?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: any[];
    metadata?: Record<string, any>;
}

/**
 * Interface for conversation service operations
 * All methods should be stateless and pure functions
 */
export interface ConversationServiceInterface {
    /**
     * Prepare conversation context from messages and configuration
     * Pure function that transforms inputs to context object
     */
    prepareContext(
        messages: Message[],
        model: string,
        provider: string,
        contextOptions?: ContextOptions,
        serviceOptions?: ConversationServiceOptions
    ): ConversationContext;

    /**
     * Generate a response using the AI provider
     * Stateless operation that handles the full request-response cycle
     */
    generateResponse(
        provider: AIProvider,
        context: ConversationContext,
        serviceOptions?: ConversationServiceOptions
    ): Promise<ConversationResponse>;

    /**
     * Generate streaming response using the AI provider
     * Stateless streaming operation
     */
    generateStreamingResponse(
        provider: AIProvider,
        context: ConversationContext,
        serviceOptions?: ConversationServiceOptions
    ): AsyncGenerator<StreamingChunk, void, unknown>;

    /**
     * Validate conversation context
     * Pure validation function
     */
    validateContext(context: ConversationContext): { isValid: boolean; errors: string[] };
}

/**
 * Interface for tool execution service operations
 */
export interface ToolExecutionServiceInterface {
    /**
     * Execute a single tool
     */
    executeTool(toolName: string, parameters: any): Promise<any>;

    /**
     * Execute multiple tools in parallel
     */
    executeToolsParallel(toolCalls: Array<{ name: string; parameters: any }>): Promise<any[]>;

    /**
     * Execute multiple tools sequentially
     */
    executeToolsSequential(toolCalls: Array<{ name: string; parameters: any }>): Promise<any[]>;
}

/**
 * Interface for execution service operations
 */
export interface ExecutionServiceInterface {
    /**
     * Execute complete agent pipeline
     */
    execute(
        input: string,
        context: ConversationContext,
        options?: any
    ): Promise<string>;

    /**
     * Execute streaming agent pipeline
     */
    executeStream(
        input: string,
        context: ConversationContext,
        options?: any
    ): AsyncGenerator<string, void, unknown>;
} 