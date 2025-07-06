/**
 * Service layer interfaces for the agents package
 * Defines contracts for stateless service implementations
 */

import type { UniversalMessage } from '../managers/conversation-history-manager';
import type { ToolSchema, AIProvider } from './provider';
import type { ToolExecutionData } from './tool';

/**
 * Reusable type definitions for service layer
 */

/**
 * Metadata type for conversation and execution context
 * Used for storing additional information about conversations, responses, and execution
 */
export type ConversationContextMetadata = Record<string, string | number | boolean | Date>;

/**
 * Tool execution parameters type
 * Used for passing parameters to tool execution methods
 */
export type ToolExecutionParameters = Record<string, string | number | boolean | string[] | number[] | boolean[]>;

/**
 * Execution metadata type
 * Used for storing metadata about execution processes and options
 */
export type ExecutionMetadata = Record<string, string | number | boolean | Date>;

/**
 * Response metadata type  
 * Used for storing metadata about AI provider responses and streaming chunks
 */
export type ResponseMetadata = Record<string, string | number | boolean | Date>;

/**
 * Tool call data structure for function calls
 */
export interface ToolCallData {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

/**
 * Tool execution request
 */
export interface ToolExecutionRequest {
    name: string;
    parameters: ToolExecutionParameters;
    executionId?: string;
}

/**
 * Conversation context containing messages and metadata
 */
export interface ConversationContext {
    /** All messages in the conversation */
    messages: UniversalMessage[];
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
    tools?: ToolSchema[];
    /** Additional metadata */
    metadata?: ConversationContextMetadata;
}

/**
 * Response from AI provider
 */
export interface ConversationResponse {
    /** Generated content */
    content: string;
    /** Tool calls if any */
    toolCalls?: ToolCallData[];
    /** Usage statistics */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    /** Response metadata */
    metadata?: ResponseMetadata;
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
    toolCalls?: ToolCallData[];
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
    tools?: ToolSchema[];
    metadata?: ConversationContextMetadata;
}

/**
 * Execution service options
 */
export interface ExecutionServiceOptions {
    /** Maximum number of tool execution rounds */
    maxToolRounds?: number;
    /** Tool execution timeout */
    toolTimeout?: number;
    /** Whether to enable parallel tool execution */
    enableParallelExecution?: boolean;
    /** Additional execution metadata */
    metadata?: ExecutionMetadata;
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
        messages: UniversalMessage[],
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
    ): AsyncGenerator<StreamingChunk, void, never>;

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
    executeTool(toolName: string, parameters: ToolExecutionParameters): Promise<ToolExecutionData>;

    /**
     * Execute multiple tools in parallel
     */
    executeToolsParallel(toolCalls: ToolExecutionRequest[]): Promise<ToolExecutionData[]>;

    /**
     * Execute multiple tools sequentially
     */
    executeToolsSequential(toolCalls: ToolExecutionRequest[]): Promise<ToolExecutionData[]>;
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
        options?: ExecutionServiceOptions
    ): Promise<string>;

    /**
     * Execute streaming agent pipeline
     */
    executeStream(
        input: string,
        context: ConversationContext,
        options?: ExecutionServiceOptions
    ): AsyncGenerator<string, void, never>;
} 