/**
 * @fileoverview Abstract AI Provider Base Class
 *
 * 🎯 ABSTRACT CLASS - DO NOT DEPEND ON CONCRETE IMPLEMENTATIONS
 *
 * Defines the shared contract and helper utilities for all AI provider implementations.
 * Concrete providers should extend this class and inject their own dependencies.
 */
import type { ToolSchema, ChatOptions, ProviderRequest, RawProviderResponse } from '../interfaces/provider';
import type { ExecutorInterface } from '../interfaces/executor';
import type { UniversalMessage } from '../managers/conversation-history-manager';
import { isAssistantMessage } from '../managers/conversation-history-manager';
import type { SimpleLogger } from '../utils/simple-logger';
import { DEFAULT_ABSTRACT_LOGGER } from '../utils/abstract-logger';

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
export interface TypeSafeAIProvider<TConfig = ProviderConfig> {
    readonly name: string;
    readonly version: string;

    configure?(config: TConfig): Promise<void> | void;
    chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage>;
    chatStream?(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage>;
    generateResponse(payload: ProviderRequest): Promise<RawProviderResponse>;
    generateStreamingResponse?(payload: ProviderRequest): AsyncIterable<RawProviderResponse>;
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
 *    export class OpenAIProvider extends AbstractAIProvider {
 *        override readonly name = 'openai';
 *        override readonly version = '1.0.0';
 *    ```
 * 
 * 2. USE IMPORTS FROM @robota-sdk/agents:
 *    ```typescript
 *    import { AbstractAIProvider } from '@robota-sdk/agents';
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
export abstract class AbstractAIProvider<TConfig = ProviderConfig>
    implements TypeSafeAIProvider<TConfig> {
    abstract readonly name: string;
    abstract readonly version: string;
    protected config?: TConfig;
    protected executor?: ExecutorInterface;
    protected readonly logger: SimpleLogger;

    constructor(logger: SimpleLogger = DEFAULT_ABSTRACT_LOGGER) {
        this.logger = logger;
    }

    /**
 * Configure the provider with type-safe configuration
 */
    async configure(config: TConfig): Promise<void> {
        this.config = config;

        // Check if config includes executor and set it
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tried-alternatives, generic-constraint
        if (config && typeof config === 'object' && 'executor' in config && (config as any).executor) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tried-alternatives, generic-constraint
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
    abstract chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage>;

    /**
     * Each provider must implement streaming chat using their own native SDK types internally
     * @param messages - Array of messages from conversation history  
     * @param options - Chat options including tools, model settings, etc.
     * @returns AsyncIterable of response chunks
     */
    abstract chatStream?(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage>;

    /**
     * Provider-agnostic raw response API.
     *
     * This is the canonical "raw payload" entrypoint required by the AIProvider contract.
     * The default implementation delegates to `chat()` and adapts the result into a
     * RawProviderResponse shape.
     */
    async generateResponse(payload: ProviderRequest): Promise<RawProviderResponse> {
        const response = await this.chat(payload.messages, {
            ...(payload.model !== undefined && { model: payload.model }),
            ...(payload.temperature !== undefined && { temperature: payload.temperature }),
            ...(payload.maxTokens !== undefined && { maxTokens: payload.maxTokens }),
            ...(payload.tools !== undefined && { tools: payload.tools })
        });

        return {
            content: response.content ?? null,
            toolCalls: isAssistantMessage(response) ? response.toolCalls : undefined,
            model: payload.model,
            metadata: payload.metadata
        };
    }

    /**
     * Provider-agnostic raw streaming API.
     *
     * If a provider does not implement chatStream, it does not support streaming.
     */
    async *generateStreamingResponse(payload: ProviderRequest): AsyncIterable<RawProviderResponse> {
        if (!this.chatStream) {
            throw new Error(`[AI-PROVIDER] Streaming is not supported by provider "${this.name}"`);
        }

        for await (const chunk of this.chatStream(payload.messages, {
            ...(payload.model !== undefined && { model: payload.model }),
            ...(payload.temperature !== undefined && { temperature: payload.temperature }),
            ...(payload.maxTokens !== undefined && { maxTokens: payload.maxTokens }),
            ...(payload.tools !== undefined && { tools: payload.tools })
        })) {
            yield {
                content: chunk.content ?? null,
                toolCalls: isAssistantMessage(chunk) ? chunk.toolCalls : undefined,
                model: payload.model,
                metadata: payload.metadata
            };
        }
    }

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
     * Execute chat via executor if available.
     *
     * This helper is meant to be called by subclasses inside their `chat()` implementation.
     */
    protected async executeViaExecutorOrDirect(
        messages: UniversalMessage[],
        options?: ChatOptions
    ): Promise<UniversalMessage> {
        if (this.executor && options?.model) {
            // Use executor for remote/proxied execution
            const result = await this.executor.executeChat({
                messages,
                options,
                provider: this.name,
                model: options.model,
                ...(options.tools && { tools: options.tools })
            });

            return result;
        }

        // Fallback to direct execution - subclasses must implement this
        throw new Error(`Direct execution not implemented for ${this.name} provider. Either provide an executor or implement direct execution.`);
    }

    /**
     * Execute streaming chat via executor if available.
     *
     * This helper is meant to be called by subclasses inside their `chatStream()` implementation.
     */
    protected async *executeStreamViaExecutorOrDirect(
        messages: UniversalMessage[],
        options?: ChatOptions
    ): AsyncIterable<UniversalMessage> {
        if (this.executor && this.executor.executeChatStream && options?.model) {
            // 🔍 [TOOL-FLOW] AbstractAIProvider.executeStreamViaExecutorOrDirect() - Preparing executor request
            this.logger.debug?.(
                '🔍 [TOOL-FLOW] AbstractAIProvider.executeStreamViaExecutorOrDirect() - Executor request',
                {
                    provider: this.name,
                    model: options.model,
                    hasTools: !!options.tools,
                    toolsCount: options.tools?.length || 0,
                    toolNames: options.tools?.map((t: ToolSchema) => t.name) || []
                }
            );

            // Use executor for remote/proxied streaming execution
            const stream = this.executor.executeChatStream({
                messages,
                options,
                provider: this.name,
                model: options.model,
                stream: true,
                ...(options.tools && { tools: options.tools })
            });

            for await (const chunk of stream) {
                yield chunk;
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