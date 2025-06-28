import type { AIProvider, ProviderConfigValue } from './provider';
import type { BasePlugin } from '../abstracts/base-plugin';
import type { BaseTool } from '../abstracts/base-tool';
import type { UtilLogLevel } from '../utils/logger';
import type { ToolExecutionResult } from './tool';

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
 * Agent configuration options
 */
export interface AgentConfig {
    id?: string;
    name?: string;
    model: string;
    provider: string;
    systemMessage?: string;
    tools?: BaseTool[];
    plugins?: BasePlugin[];
    temperature?: number;
    maxTokens?: number;
    metadata?: MessageMetadata;
    // Provider configuration
    aiProviders?: Record<string, AIProvider>;
    currentProvider?: string;
    currentModel?: string;
    // Conversation management
    conversationId?: string;
    // Logging configuration
    logging?: {
        level?: UtilLogLevel;
        enabled?: boolean;
    };
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
 * Agent run options - extended for logger compatibility
 * 
 * REASON: Added simple index signature for compatibility with LoggerContextData
 * ALTERNATIVES_CONSIDERED:
 * 1. JSON.stringify RunOptions in logging calls (loses type safety)
 * 2. Create separate logging wrappers (unnecessary abstraction)
 * 3. Use type assertions in logger calls (decreases type safety)
 * 4. Avoid logging RunOptions directly (reduces debugging capability)
 * 5. Complex index signature with all types (causes TypeScript compatibility issues)
 * TODO: Monitor for conflicts between index signature and explicit properties
 */
export interface RunOptions {
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    toolChoice?: 'auto' | 'none' | string;
    sessionId?: string;
    userId?: string;
    metadata?: MessageMetadata;
    [key: string]: any; // Simplified for compatibility
}

/**
 * Agent interface
 */
export interface AgentInterface {
    /**
     * Run agent with user input
     */
    run(input: string, options?: RunOptions): Promise<string>;

    /**
     * Run agent with streaming response
     */
    runStream(input: string, options?: RunOptions): AsyncGenerator<string, void, never>;

    /**
     * Get conversation history
     */
    getHistory(): Message[];

    /**
     * Clear conversation history
     */
    clearHistory(): void;
} 