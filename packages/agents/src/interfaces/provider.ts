import type { TUniversalMessage, IToolCall } from './messages';

/**
 * Reusable type definitions for provider layer
 */

/**
 * Provider configuration value type
 * Used for storing provider-specific configuration values
 */
export type TProviderConfigValue = string | number | boolean;

/**
 * JSON Schema parameter default value type
 * Used for default values in parameter schemas
 */
export type TParameterDefaultValue = string | number | boolean | null;

/**
 * JSON Schema primitive types
 */
export type TJSONSchemaKind = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';

/**
 * JSON Schema enum values
 */
export type TJSONSchemaEnum = string[] | number[] | boolean[] | (string | number | boolean)[];

/**
 * Tool schema definition
 */
export interface IToolSchema {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, IParameterSchema>;
        required?: string[];
    };
}

/**
 * Parameter schema for tools
 */
export interface IParameterSchema {
    type: TJSONSchemaKind;
    description?: string;
    enum?: TJSONSchemaEnum;
    items?: IParameterSchema;
    properties?: Record<string, IParameterSchema>;
    minimum?: number;
    maximum?: number;
    pattern?: string;
    format?: string;
    default?: TParameterDefaultValue;
}

/**
 * Token usage statistics
 */
export interface ITokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

/**
 * Raw provider response interface
 */
export interface IRawProviderResponse {
    content: string | null;
    toolCalls?: IToolCall[];
    usage?: ITokenUsage;
    finishReason?: string;
    model?: string;
    metadata?: Record<string, TProviderConfigValue>;
}

/**
 * Provider request payload
 */
export interface IProviderRequest {
    messages: TUniversalMessage[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: IToolSchema[];
    systemMessage?: string;
    metadata?: Record<string, string | number | boolean>;
}

/**
 * Provider-specific configuration options
 */
export interface IProviderSpecificOptions {
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
        responseModalities?: Array<'TEXT' | 'IMAGE'>;
        topP?: number;
        topK?: number;
    };
}

/**
 * Options for AI provider chat requests
 */
export interface IChatOptions extends IProviderSpecificOptions {
    /** Tool schemas to provide to the AI provider */
    tools?: IToolSchema[];
    /** Maximum number of tokens to generate */
    maxTokens?: number;
    /** Temperature for response randomness (0-1) */
    temperature?: number;
    /** Model to use for the request */
    model?: string;
}

/**
 * Provider-agnostic AI Provider interface
 * This interface uses only TUniversalMessage types and avoids provider-specific types
 */
export interface IAIProvider {
    /** Provider identifier */
    readonly name: string;
    /** Provider version */
    readonly version: string;

    /**
     * Generate response from AI model using TUniversalMessage
     * @param messages - Array of TUniversalMessage from conversation history
     * @param options - Chat options including tools, model settings, etc.
     * @returns Promise resolving to a TUniversalMessage response
     */
    chat(messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage>;

    /**
     * Generate streaming response from AI model using TUniversalMessage
     * @param messages - Array of TUniversalMessage from conversation history
     * @param options - Chat options including tools, model settings, etc.
     * @returns AsyncIterable of TUniversalMessage chunks
     */
    chatStream?(messages: TUniversalMessage[], options?: IChatOptions): AsyncIterable<TUniversalMessage>;

    /**
     * Generate response from AI model (raw provider response)
     * @param payload - Provider request payload
     * @returns Promise resolving to raw provider response
     */
    generateResponse(payload: IProviderRequest): Promise<IRawProviderResponse>;

    /**
     * Generate streaming response from AI model (raw provider response)
     * @param payload - Provider request payload
     * @returns AsyncIterable of raw provider response chunks
     */
    generateStreamingResponse?(payload: IProviderRequest): AsyncIterable<IRawProviderResponse>;

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

    /**
     * Close provider connections and cleanup resources
     */
    close?(): Promise<void>;
}

/**
 * Provider options interface
 */
export interface IProviderOptions {
    apiKey?: string;
    baseURL?: string;
    timeout?: number;
    retries?: number;
    maxConcurrentRequests?: number;
    defaultModel?: string;
    organization?: string;
    project?: string;
    /** Additional provider-specific configuration */
    extra?: Record<string, TProviderConfigValue>;
} 

/**
 * Base union for provider option values.
 *
 * Purpose:
 * - Enable provider packages to compose their own option value unions without redefining the primitives.
 * - Keep the shared axis in @robota-sdk/agents (SSOT).
 *
 * Note:
 * - Provider packages may extend this with provider-specific runtime objects (e.g., OpenAI/Anthropic clients).
 */
export type TProviderOptionValueBase =
    | string
    | number
    | boolean
    | undefined
    | null
    | TProviderOptionValueBase[]
    | { [key: string]: TProviderOptionValueBase };