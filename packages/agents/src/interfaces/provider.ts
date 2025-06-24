import type { ToolCall } from './agent';
import type { UniversalMessage } from '../managers/conversation-history-manager';

/**
 * Context for AI provider requests
 */
export interface Context {
    messages: UniversalMessage[];
    systemMessage?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: ToolSchema[];
    metadata?: Record<string, any>;
}

/**
 * Response from AI model
 */
export interface ModelResponse {
    content?: string;
    toolCalls?: ToolCall[];
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    metadata?: {
        model?: string;
        finishReason?: string;
        [key: string]: any;
    };
}

/**
 * Streaming response chunk
 */
export interface StreamingResponseChunk {
    content?: string;
    toolCall?: Partial<ToolCall>;
    isComplete?: boolean;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

/**
 * Tool schema definition
 */
export interface ToolSchema {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, ParameterSchema>;
        required?: string[];
    };
}

/**
 * Parameter schema for tools
 */
export interface ParameterSchema {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description?: string;
    enum?: any[];
    items?: ParameterSchema;
    properties?: Record<string, ParameterSchema>;
}

/**
 * AI Provider interface
 */
export interface AIProvider {
    /** Provider name */
    name: string;

    /** Available models */
    models: string[];

    /**
     * Generate response from AI model
     */
    chat(model: string, context: Context, options?: any): Promise<ModelResponse>;

    /**
     * Generate streaming response from AI model
     */
    chatStream?(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown>;

    /**
     * Generate response using raw request payload (for ConversationService)
     */
    generateResponse(request: any): Promise<any>;

    /**
     * Generate streaming response using raw request payload (for ConversationService)
     */
    generateStreamingResponse?(request: any): AsyncGenerator<any, void, unknown>;

    /**
     * Check if model is supported
     */
    supportsModel(model: string): boolean;

    /**
     * Resource cleanup
     */
    close?(): Promise<void>;
}

/**
 * Provider options interface
 */
export interface ProviderOptions {
    apiKey?: string;
    baseURL?: string;
    timeout?: number;
    retries?: number;
    [key: string]: any;
} 