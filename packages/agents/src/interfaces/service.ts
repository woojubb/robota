/**
 * Service layer interfaces for the agents package
 * Defines contracts for stateless service implementations
 */

import type { TUniversalMessage } from '../managers/conversation-history-manager';
import type { IToolSchema, IAIProvider } from './provider';
import type { TToolExecutionData } from './tool';
import type { IToolCall } from './messages';

/**
 * Reusable type definitions for service layer
 */

/**
 * Metadata type for conversation and execution context
 * Used for storing additional information about conversations, responses, and execution
 */
export type TConversationContextMetadata = Record<string, string | number | boolean | Date>;

/**
 * Tool execution parameters type
 * Used for passing parameters to tool execution methods
 */
export type TToolExecutionParameters = Record<string, string | number | boolean | string[] | number[] | boolean[]>;

/**
 * Execution metadata type
 * Used for storing metadata about execution processes and options
 */
export type TExecutionMetadata = Record<string, string | number | boolean | Date>;

/**
 * Response metadata type  
 * Used for storing metadata about AI provider responses and streaming chunks
 */
export type TResponseMetadata = Record<string, string | number | boolean | Date>;

/**
 * Tool call data structure for function calls
 */
/**
 * Tool execution request
 */
export interface IToolExecutionRequest {
    name: string;
    parameters: TToolExecutionParameters;
    executionId?: string;
}

/**
 * Conversation context containing messages and metadata
 */
export interface IConversationContext {
    /** All messages in the conversation */
    messages: TUniversalMessage[];
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
    tools?: IToolSchema[];
    /** Additional metadata */
    metadata?: TConversationContextMetadata;
}

/**
 * Response from AI provider
 */
export interface IConversationResponse {
    /** Generated content */
    content: string;
    /** Tool calls if any */
    toolCalls?: IToolCall[];
    /** Usage statistics */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    /** Response metadata */
    metadata?: TResponseMetadata;
    /** Finish reason */
    finishReason?: string;
}

/**
 * Streaming response chunk
 */
export interface IStreamingChunk {
    /** Content delta */
    delta: string;
    /** Whether this is the final chunk */
    done: boolean;
    /** Tool calls if any */
    toolCalls?: IToolCall[];
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
export interface IContextOptions {
    systemMessage?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: IToolSchema[];
    metadata?: TConversationContextMetadata;
}

/**
 * Execution service options
 */
export interface IExecutionServiceOptions {
    /** Maximum number of tool execution rounds */
    maxToolRounds?: number;
    /** Tool execution timeout */
    toolTimeout?: number;
    /** Whether to enable parallel tool execution */
    enableParallelExecution?: boolean;
    /** Additional execution metadata */
    metadata?: TExecutionMetadata;
}

/**
 * Interface for conversation service operations
 * All methods should be stateless and pure functions
 */
export interface IConversationService {
    /**
     * Prepare conversation context from messages and configuration
     * Pure function that transforms inputs to context object
     */
    prepareContext(
        messages: TUniversalMessage[],
        model: string,
        provider: string,
        contextOptions?: IContextOptions,
        serviceOptions?: ConversationServiceOptions
    ): IConversationContext;

    /**
     * Generate a response using the AI provider
     * Stateless operation that handles the full request-response cycle
     */
    generateResponse(
        provider: IAIProvider,
        context: IConversationContext,
        serviceOptions?: ConversationServiceOptions
    ): Promise<IConversationResponse>;

    /**
     * Generate streaming response using the AI provider
     * Stateless streaming operation
     */
    generateStreamingResponse(
        provider: IAIProvider,
        context: IConversationContext,
        serviceOptions?: ConversationServiceOptions
    ): AsyncGenerator<IStreamingChunk, void, never>;

    /**
     * Validate conversation context
     * Pure validation function
     */
    validateContext(context: IConversationContext): { isValid: boolean; errors: string[] };
}

/**
 * Interface for tool execution service operations
 */
export interface IToolExecutionService {
    /**
     * Execute a single tool
     */
    executeTool(toolName: string, parameters: TToolExecutionParameters): Promise<TToolExecutionData>;

    /**
     * Execute multiple tools in parallel
     */
    executeToolsParallel(toolCalls: IToolExecutionRequest[]): Promise<TToolExecutionData[]>;

    /**
     * Execute multiple tools sequentially
     */
    executeToolsSequential(toolCalls: IToolExecutionRequest[]): Promise<TToolExecutionData[]>;
}

/**
 * Interface for execution service operations
 */
export interface IExecutionService {
    /**
     * Execute complete agent pipeline
     */
    execute(
        input: string,
        context: IConversationContext,
        options?: IExecutionServiceOptions
    ): Promise<string>;

    /**
     * Execute streaming agent pipeline
     */
    executeStream(
        input: string,
        context: IConversationContext,
        options?: IExecutionServiceOptions
    ): AsyncGenerator<string, void, never>;
} 