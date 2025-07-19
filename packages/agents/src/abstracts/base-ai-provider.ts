import type { ToolSchema, ChatOptions } from '../interfaces/provider';
import type { ExecutorInterface } from '../interfaces/executor';
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
 * Enhanced provider configuration that supports executor injection
 */
export interface ExecutorAwareProviderConfig {
    apiKey?: string;
    baseUrl?: string;
    timeout?: number;
    /**
     * Optional executor for handling AI requests
     * When provided, the provider will delegate all chat operations to this executor
     * instead of making direct API calls. This enables remote execution capabilities.
     */
    executor?: ExecutorInterface;
    [key: string]: string | number | boolean | ExecutorInterface | undefined;
}

/**
 * Base AI provider implementation with proper type constraints
 * All AI providers should extend this class
 * 
 * ========================================
 * CRITICAL IMPLEMENTATION GUIDELINES
 * ========================================
 * 
 * ALL AI PROVIDER IMPLEMENTATIONS (OpenAI, Anthropic, Google, etc.) MUST:
 * 
 * 1. EXTEND THIS CLASS:
 *    ```typescript
 *    export class OpenAIProvider extends BaseAIProvider {
 *        override readonly name = 'openai';
 *        override readonly version = '1.0.0';
 *    ```
 * 
 * 2. USE IMPORTS FROM @robota-sdk/agents:
 *    ```typescript
 *    import { BaseAIProvider } from '@robota-sdk/agents';
 *    import type {
 *        UniversalMessage,
 *        ChatOptions,
 *        ToolCall,
 *        ToolSchema,
 *        AssistantMessage
 *    } from '@robota-sdk/agents';
 *    ```
 * 
 * 3. USE OVERRIDE KEYWORD FOR ALL INHERITED METHODS:
 *    - override async chat(...)
 *    - override async *chatStream(...)
 *    - override supportsTools()
 *    - override validateConfig()
 *    - override async dispose()
 * 
 * 4. DO NOT REDEFINE TYPES THAT EXIST IN @robota-sdk/agents:
 *    - UniversalMessage
 *    - ChatOptions
 *    - ToolCall
 *    - ToolSchema
 *    - AssistantMessage
 *    - SystemMessage
 *    - UserMessage
 *    - ToolMessage
 * 
 * 5. HANDLE MESSAGE CONTENT PROPERLY:
 *    - For tool calls: content should be null (not empty string)
 *    - For regular messages: content can be string or null
 *    - Always preserve null values from API responses
 * 
 * 6. CALL SUPER() IN CONSTRUCTOR:
 *    ```typescript
 *    constructor(options: ProviderOptions) {
 *        super();
 *        // provider-specific initialization
 *    }
 *    ```
 * 
 * This ensures ExecutionService can properly identify providers
 * and prevents type conflicts across the codebase.
 * 
 * ========================================
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
    protected executor?: ExecutorInterface;

    /**
 * Configure the provider with type-safe configuration
 */
    async configure(config: TConfig): Promise<void> {
        this.config = config;

        // Check if config includes executor and set it
        if (config && typeof config === 'object' && 'executor' in config && (config as any).executor) {
            this.executor = (config as any).executor as ExecutorInterface;
        }

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

    /**
     * Check if this provider is using an executor for execution
     * @returns true if executor is configured
     */
    protected isUsingExecutor(): boolean {
        return this.executor !== undefined;
    }

    /**
 * Execute chat via executor if available, otherwise fallback to direct implementation
 * This method should be called by subclasses in their chat() implementation
 */
    protected async executeViaExecutorOrDirect(
        messages: TMessage[],
        options?: ChatOptions
    ): Promise<TResponse> {
        if (this.executor && options?.model) {
            // Use executor for remote/proxied execution
            const result = await this.executor.executeChat({
                messages: messages as UniversalMessage[],
                options,
                provider: this.name,
                model: options.model,
                ...(options.tools && { tools: options.tools })
            });

            return result as TResponse;
        }

        // Fallback to direct execution - subclasses must implement this
        throw new Error(`Direct execution not implemented for ${this.name} provider. Either provide an executor or implement direct execution.`);
    }

    /**
 * Execute streaming chat via executor if available, otherwise fallback to direct implementation
 * This method should be called by subclasses in their chatStream() implementation
 */
    protected async *executeStreamViaExecutorOrDirect(
        messages: TMessage[],
        options?: ChatOptions
    ): AsyncIterable<TResponse> {
        if (this.executor && this.executor.executeChatStream && options?.model) {
            // Use executor for remote/proxied streaming execution
            const stream = this.executor.executeChatStream({
                messages: messages as UniversalMessage[],
                options,
                provider: this.name,
                model: options.model,
                stream: true,
                ...(options.tools && { tools: options.tools })
            });

            for await (const chunk of stream) {
                yield chunk as TResponse;
            }
            return;
        }

        // Fallback to direct execution - subclasses must implement this
        throw new Error(`Direct streaming execution not implemented for ${this.name} provider. Either provide an executor or implement direct streaming execution.`);
    }

    /**
     * Clean up resources when provider is no longer needed
     * Override this method in subclasses for additional cleanup
     */
    async dispose(): Promise<void> {
        // Clean up executor if present
        if (this.executor?.dispose) {
            await this.executor.dispose();
        }

        // Subclasses can override for additional cleanup
    }
} 