import type { ToolSchema, ChatOptions } from '../interfaces/provider';
import type { UniversalMessage } from '../managers/conversation-history-manager';
import { logger } from '../utils/logger';

/**
 * Provider logging data type
 * Used for storing logging information in provider operations
 */
export type ProviderLoggingData = Record<string, string | number | boolean | Date | string[]>;

/**
 * Type-safe AI provider interface with proper generic constraints
 * 
 * @template TConfig - Provider configuration type (defaults to ProviderConfig for type safety)
 * @template TMessage - Message type (defaults to UniversalMessage for backward compatibility)
 * @template TResponse - Response type (defaults to UniversalMessage for backward compatibility)
 */
export interface TypeSafeAIProvider<TConfig = ProviderConfig, TMessage = UniversalMessage, TResponse = UniversalMessage> {
    readonly name: string;
    readonly version: string;

    configure?(config: TConfig): Promise<void> | void;
    chat(messages: TMessage[], options?: ChatOptions): Promise<TResponse>;
    chatStream?(messages: TMessage[], options?: ChatOptions): AsyncIterable<TResponse>;
    supportsTools(): boolean;
    validateConfig(): boolean;
    dispose(): Promise<void>;
}

/**
 * Provider configuration base interface
 */
export interface ProviderConfig {
    apiKey?: string;
    baseUrl?: string;
    timeout?: number;
    [key: string]: string | number | boolean | undefined;
}

/**
 * Base AI provider implementation with proper type constraints
 * All AI providers should extend this class
 * 
 * @template TConfig - Provider configuration type (defaults to ProviderConfig for type safety)
 * @template TMessage - Message type (defaults to UniversalMessage for backward compatibility)
 * @template TResponse - Response type (defaults to UniversalMessage for backward compatibility)
 */
export abstract class BaseAIProvider<TConfig = ProviderConfig, TMessage = UniversalMessage, TResponse = UniversalMessage>
    implements TypeSafeAIProvider<TConfig, TMessage, TResponse> {
    abstract readonly name: string;
    abstract readonly version: string;
    protected config?: TConfig;

    /**
     * Configure the provider with type-safe configuration
     */
    async configure(config: TConfig): Promise<void> {
        this.config = config;
        // Subclasses can override for additional setup
    }

    /**
     * Each provider must implement chat using their own native SDK types internally
     * @param messages - Array of messages from conversation history
     * @param options - Chat options including tools, model settings, etc.
     * @returns Promise resolving to a response
     */
    abstract chat(messages: TMessage[], options?: ChatOptions): Promise<TResponse>;

    /**
     * Each provider must implement streaming chat using their own native SDK types internally
     * @param messages - Array of messages from conversation history  
     * @param options - Chat options including tools, model settings, etc.
     * @returns AsyncIterable of response chunks
     */
    abstract chatStream?(messages: TMessage[], options?: ChatOptions): AsyncIterable<TResponse>;

    /**
     * Default implementation - most modern providers support tools
     * @returns true if tool calling is supported
     */
    supportsTools(): boolean {
        return true;
    }

    /**
     * Default implementation - providers can override for specific validation
     * @returns true if configuration is valid
     */
    validateConfig(): boolean {
        return true;
    }

    /**
     * Default implementation - providers can override for cleanup
     */
    async dispose(): Promise<void> {
        // Default: no cleanup needed
    }

    /**
     * Utility method for validating UniversalMessage array
     * @param messages - Messages to validate
     */
    protected validateMessages(messages: UniversalMessage[]): void {
        if (!Array.isArray(messages)) {
            throw new Error('Messages must be an array');
        }

        if (messages.length === 0) {
            throw new Error('Messages array cannot be empty');
        }

        for (const message of messages) {
            if (!message.role || !['user', 'assistant', 'system', 'tool'].includes(message.role)) {
                throw new Error(`Invalid message role: ${message.role}`);
            }
        }
    }

    /**
     * Utility method for validating tool schemas
     * @param tools - Tool schemas to validate
     */
    protected validateTools(tools?: ToolSchema[]): void {
        if (!tools) return;

        if (!Array.isArray(tools)) {
            throw new Error('Tools must be an array');
        }

        for (const tool of tools) {
            if (!tool.name || typeof tool.name !== 'string') {
                throw new Error('Tool must have a valid name');
            }
            if (!tool.description || typeof tool.description !== 'string') {
                throw new Error('Tool must have a valid description');
            }
            if (!tool.parameters || typeof tool.parameters !== 'object' || tool.parameters === null || Array.isArray(tool.parameters)) {
                throw new Error('Tool must have valid parameters');
            }
        }
    }

    /**
     * Utility method for logging provider operations
     * @param operation - Operation name
     * @param data - Additional data to log
     */
    protected log(operation: string, data?: ProviderLoggingData): void {
        logger.debug(`${this.name} Provider: ${operation}`, data);
    }
} 