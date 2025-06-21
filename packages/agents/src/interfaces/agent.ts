/**
 * Base message interface for agent communication
 */
export interface BaseMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp?: Date;
    metadata?: Record<string, any>;
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
    result: any;
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

/**
 * Agent configuration options
 */
export interface AgentConfig {
    id?: string;
    name?: string;
    model: string;
    provider: string;
    systemMessage?: string;
    tools?: any[];
    plugins?: any[];
    temperature?: number;
    maxTokens?: number;
    metadata?: Record<string, any>;
    // Legacy properties for compatibility
    aiProviders?: Record<string, any>;
    currentProvider?: string;
    currentModel?: string;
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
 * Agent run options
 */
export interface RunOptions {
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    toolChoice?: 'auto' | 'none' | string;
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
    runStream(input: string, options?: RunOptions): AsyncGenerator<string, void, unknown>;

    /**
     * Get conversation history
     */
    getHistory(): Message[];

    /**
     * Clear conversation history
     */
    clearHistory(): void;
} 