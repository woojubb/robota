import type { ProviderConfigValue, AIProvider } from './provider';
import type { AbstractPlugin, BasePluginOptions, PluginStats } from '../abstracts/abstract-plugin';
import type { AbstractTool } from '../abstracts/abstract-tool';
import type { AbstractModule } from '../abstracts/abstract-module';
import type { UtilLogLevel } from '../utils/logger';
import type { TMetadata, TConfigValue } from './types';
import type { IEventService } from '../services/event-service';
import type { IOwnerPathSegment } from '../services/event-service';
import type { TUniversalMessageMetadata, TUniversalMessage } from './messages';

export type {
    TUniversalMessage,
    TUniversalMessageMetadata,
    IBaseMessage,
    IUserMessage,
    IAssistantMessage,
    ISystemMessage,
    IToolMessage,
    IToolCall,
    TUniversalMessageRole,
} from './messages';

/**
 * ExecutionContextInjection
 *
 * Minimal context payload used to inject an existing ownerPath into a new agent instance
 * (e.g., when a tool creates an agent and must preserve absolute ownerPath semantics).
 *
 * NOTE: This is intentionally NOT ToolExecutionContext. ToolExecutionContext is for tool calls
 * and requires toolName/parameters; agent creation only needs ownerPath and execution linkage.
 */
export interface ExecutionContextInjection {
    ownerPath?: IOwnerPathSegment[];
    parentExecutionId?: string;
    rootExecutionId?: string;
    executionLevel?: number;
    sourceId?: string;
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
        [key: string]: ProviderConfigValue | undefined;
    };
    anthropic?: {
        apiKey?: string;
        baseURL?: string;
        [key: string]: ProviderConfigValue | undefined;
    };
    google?: {
        apiKey?: string;
        projectId?: string;
        location?: string;
        [key: string]: ProviderConfigValue | undefined;
    };
    [provider: string]: Record<string, ProviderConfigValue | undefined> | undefined;
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
    tools?: AbstractTool[];
    plugins?: Array<AbstractPlugin<BasePluginOptions, PluginStats>>;

    // Modules for extended functionality
    modules?: AbstractModule[];

    // System configuration
    systemMessage?: string;
    systemPrompt?: string;

    // Conversation management
    conversationId?: string;
    sessionId?: string;
    userId?: string;

    // Metadata and context
    metadata?: TUniversalMessageMetadata;
    context?: Record<string, TConfigValue>;

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

    // Event tracking
    eventService?: IEventService;

    // 🎯 [CONTEXT-INJECTION] Execution context for hierarchical agent management
    executionContext?: ExecutionContextInjection;
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
    metadata?: TMetadata;
}

/**
 * Generic agent interface with type parameters for enhanced type safety
 * 
 * @template TConfig - Agent configuration type (defaults to AgentConfig for backward compatibility)
 * @template TContext - Execution context type (defaults to RunOptions for backward compatibility)
 * @template TUniversalMessage - Message type (defaults to TUniversalMessage for backward compatibility)
 */
export interface BaseAgentInterface<
    TConfig = AgentConfig,
    TContext = RunOptions,
    TMessage = TUniversalMessage
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
    getHistory(): TUniversalMessage[];

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
    metadata?: TMetadata;

    // Provider-agnostic options that can be used by any provider
    providerOptions?: Record<string, TConfigValue>;

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
    schema?: Record<string, TConfigValue>;
}

/**
 * Safety setting configuration
 */
export interface SafetySetting {
    category: string;
    threshold: string;
    [key: string]: TConfigValue;
}

/**
 * Generation configuration
 */
export interface GenerationConfig {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
    [key: string]: TConfigValue;
}

/**
 * Legacy agent interface for backward compatibility
 * @deprecated Use BaseAgentInterface or provider-specific interfaces instead
 */
export interface AgentInterface extends BaseAgentInterface<AgentConfig, RunOptions, TUniversalMessage> { } 