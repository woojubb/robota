import type { UniversalMessage } from '../managers/conversation-history-manager';



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
 * Options for AI provider chat requests
 */
export interface ChatOptions {
    /** Tool schemas to provide to the AI provider */
    tools?: ToolSchema[];
    /** Maximum number of tokens to generate */
    maxTokens?: number;
    /** Temperature for response randomness (0-1) */
    temperature?: number;
    /** Model to use for the request */
    model?: string;
    /** Provider-specific options can be added via this index signature */
    [key: string]: any;
}

/**
 * Provider-agnostic AI Provider interface
 * This interface uses only UniversalMessage types and avoids provider-specific types
 */
export interface AIProvider {
    /** Provider identifier */
    readonly name: string;
    /** Provider version */
    readonly version: string;

    /**
     * Generate response from AI model using UniversalMessage
     * @param messages - Array of UniversalMessage from conversation history
     * @param options - Chat options including tools, model settings, etc.
     * @returns Promise resolving to a UniversalMessage response
     */
    chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage>;

    /**
     * Generate streaming response from AI model using UniversalMessage
     * @param messages - Array of UniversalMessage from conversation history
     * @param options - Chat options including tools, model settings, etc.
     * @returns AsyncIterable of UniversalMessage chunks
     */
    chatStream?(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage>;

    /**
     * Check if the provider supports tool calling
     * @returns true if tool calling is supported
     */
    supportsTools(): boolean;

    /**
     * Validate provider configuration
     * @returns true if configuration is valid
     */
    validateConfig(): boolean;

    /**
     * Clean up resources when provider is no longer needed
     */
    dispose?(): Promise<void>;
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