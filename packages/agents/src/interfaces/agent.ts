import type { ProviderConfigValue, AIProvider } from './provider';
import type { BasePlugin, BasePluginOptions, PluginStats } from '../abstracts/base-plugin';
import type { BaseTool } from '../abstracts/base-tool';
import type { BaseModule } from '../abstracts/base-module';
import type { UtilLogLevel } from '../utils/logger';
import type { ToolExecutionResult } from './tool';
import type { Metadata, ConfigValue } from './types';

/**
 * Message metadata structure - specific type definition for agents
 */
export type MessageMetadata = Record<string, string | number | boolean | Date>;

/**
 * Base message interface for agent communication
 */
export interface BaseMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp?: Date;
    metadata?: MessageMetadata;
}

/**
 * User message interface
 */
export interface UserMessage extends BaseMessage {
    role: 'user';
}

/**
 * Assistant message interface
 */
export interface AssistantMessage extends BaseMessage {
    role: 'assistant';
    toolCalls?: ToolCall[];
}

/**
 * System message interface
 */
export interface SystemMessage extends BaseMessage {
    role: 'system';
}

/**
 * Tool message interface
 */
export interface ToolMessage extends BaseMessage {
    role: 'tool';
    toolCallId: string;
    result: ToolExecutionResult;
}

/**
 * Universal message type
 */
export type Message = UserMessage | AssistantMessage | SystemMessage | ToolMessage;

/**
 * Tool call interface
 */
export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

// ProviderConfigValue imported from provider.ts for type ownership consistency

/**
 * Provider-specific configuration
 */
export interface ProviderConfig {
    openai?: {
        apiKey?: string;
        baseURL?: string;
        organization?: string;
        [key: string]: ProviderConfigValue;
    };
    anthropic?: {
        apiKey?: string;
        baseURL?: string;
        [key: string]: ProviderConfigValue;
    };
    google?: {
        apiKey?: string;
        projectId?: string;
        location?: string;
        [key: string]: ProviderConfigValue;
    };
    [provider: string]: Record<string, ProviderConfigValue> | undefined;
}

/**
 * Agent configuration options - New design with aiProviders array and defaultModel
 */
export interface AgentConfig {
    id?: string;
    name: string;
    aiProviders: AIProvider[];
    defaultModel: {
        provider: string;
        model: string;
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        systemMessage?: string;
    };

    // Tools and plugins
    tools?: BaseTool[];
    plugins?: Array<BasePlugin<BasePluginOptions, PluginStats>>;

    // Modules for extended functionality
    modules?: BaseModule[];

    // Model configuration (for backward compatibility and runtime overrides)
    model?: string;
    provider?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    stopSequences?: string[];
    seed?: number;

    // System configuration
    systemMessage?: string;
    systemPrompt?: string;

    // Conversation management
    conversationId?: string;
    sessionId?: string;
    userId?: string;

    // Metadata and context
    metadata?: MessageMetadata;
    context?: Record<string, ConfigValue>;

    // Logging configuration
    logging?: {
        level?: UtilLogLevel;
        enabled?: boolean;
        format?: string;
        destination?: string;
    };

    // Provider-specific configurations
    providerConfig?: ProviderConfig;

    // Execution options
    stream?: boolean;
    toolChoice?: 'auto' | 'none' | string;
    responseFormat?: ResponseFormatConfig;
    safetySettings?: SafetySetting[];

    // Performance and limits
    timeout?: number;
    retryAttempts?: number;
    rateLimiting?: {
        enabled?: boolean;
        maxRequests?: number;
        windowMs?: number;
    };

    // Index signature for type parameter constraints compatibility
    [key: string]: ConfigValue;
}

/**
 * Agent template interface
 */
export interface AgentTemplate {
    id: string;
    name: string;
    description?: string;
    category?: string;
    tags?: string[];
    config: AgentConfig;
    version?: string;
    author?: string;
    createdAt?: Date;
    updatedAt?: Date;
}

/**
 * Agent run options - type-safe interface for all agent execution options
 */
export interface RunOptions {
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    toolChoice?: 'auto' | 'none' | string;
    sessionId?: string;
    userId?: string;
    metadata?: Metadata;
    // Index signature for type parameter constraints compatibility
    [key: string]: ConfigValue;
}

/**
 * Generic agent interface with type parameters for enhanced type safety
 * 
 * @template TConfig - Agent configuration type (defaults to AgentConfig for backward compatibility)
 * @template TContext - Execution context type (defaults to RunOptions for backward compatibility)
 * @template TMessage - Message type (defaults to Message for backward compatibility)
 */
export interface BaseAgentInterface<
    TConfig = AgentConfig,
    TContext = RunOptions,
    TMessage = Message
> {
    /**
     * Configure the agent with type-safe configuration
     */
    configure?(config: TConfig): Promise<void>;

    /**
     * Run agent with user input and type-safe context
     */
    run(input: string, context?: TContext): Promise<string>;

    /**
     * Run agent with streaming response and type-safe context
     */
    runStream(input: string, context?: TContext): AsyncGenerator<string, void, never>;

    /**
     * Get conversation history with type-safe messages
     */
    getHistory(): TMessage[];

    /**
     * Clear conversation history
     */
    clearHistory(): void;
}

/**
 * Extended run context with provider-agnostic options
 * Supports dynamic provider configurations without hardcoding specific providers
 */
export interface ExtendedRunContext {
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    toolChoice?: 'auto' | 'none' | string;
    sessionId?: string;
    userId?: string;
    metadata?: Metadata;

    // Provider-agnostic options that can be used by any provider
    providerOptions?: Record<string, ConfigValue>;

    // Common provider options (provider-agnostic naming)
    stopSequences?: string[];
    topK?: number;
    topP?: number;
    seed?: number;

    // Advanced configuration with specific types
    responseFormat?: ResponseFormatConfig;
    safetySettings?: SafetySetting[];
    generationConfig?: GenerationConfig;
}

/**
 * Response format configuration
 */
export interface ResponseFormatConfig {
    type?: 'text' | 'json_object';
    schema?: Record<string, ConfigValue>;
}

/**
 * Safety setting configuration
 */
export interface SafetySetting {
    category: string;
    threshold: string;
    [key: string]: ConfigValue;
}

/**
 * Generation configuration
 */
export interface GenerationConfig {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
    [key: string]: ConfigValue;
}

/**
 * Legacy agent interface for backward compatibility
 * @deprecated Use BaseAgentInterface or provider-specific interfaces instead
 */
export interface AgentInterface extends BaseAgentInterface<AgentConfig, RunOptions, Message> { } 