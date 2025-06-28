import type { UniversalMessage } from '../managers/conversation-history-manager';

/**
 * Reusable type definitions for provider layer
 */

/**
 * Provider configuration value type
 * Used for storing provider-specific configuration values
 */
export type ProviderConfigValue = string | number | boolean;

/**
 * JSON Schema parameter default value type
 * Used for default values in parameter schemas
 */
export type ParameterDefaultValue = string | number | boolean | null;

/**
 * JSON Schema primitive types
 */
export type JSONSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';

/**
 * JSON Schema enum values
 */
export type JSONSchemaEnum = string[] | number[] | boolean[] | (string | number | boolean)[];

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
    type: JSONSchemaType;
    description?: string;
    enum?: JSONSchemaEnum;
    items?: ParameterSchema;
    properties?: Record<string, ParameterSchema>;
    minimum?: number;
    maximum?: number;
    pattern?: string;
    format?: string;
    default?: ParameterDefaultValue;
}

/**
 * Provider-specific configuration options
 */
export interface ProviderSpecificOptions {
    /** OpenAI specific options */
    openai?: {
        organization?: string;
        user?: string;
        stop?: string | string[];
        presencePenalty?: number;
        frequencyPenalty?: number;
        logitBias?: Record<string, number>;
        topP?: number;
        n?: number;
        stream?: boolean;
        suffix?: string;
        echo?: boolean;
        bestOf?: number;
        logprobs?: number;
    };

    /** Anthropic specific options */
    anthropic?: {
        stopSequences?: string[];
        topP?: number;
        topK?: number;
        metadata?: {
            userId?: string;
        };
    };

    /** Google specific options */
    google?: {
        candidateCount?: number;
        stopSequences?: string[];
        safetySettings?: Array<{
            category: string;
            threshold: string;
        }>;
        topP?: number;
        topK?: number;
    };
}

/**
 * Options for AI provider chat requests
 */
export interface ChatOptions extends ProviderSpecificOptions {
    /** Tool schemas to provide to the AI provider */
    tools?: ToolSchema[];
    /** Maximum number of tokens to generate */
    maxTokens?: number;
    /** Temperature for response randomness (0-1) */
    temperature?: number;
    /** Model to use for the request */
    model?: string;
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
    maxConcurrentRequests?: number;
    defaultModel?: string;
    organization?: string;
    project?: string;
    /** Additional provider-specific configuration */
    extra?: Record<string, ProviderConfigValue>;
} 