import type { FunctionCall, FunctionCallResult } from '@robota-sdk/tools';

/**
 * Universal message role type - Provider-independent neutral role
 * 
 * @public
 */
export type UniversalMessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Base message interface with common properties
 * 
 * @public
 */
export interface BaseMessage {
    /** Message creation timestamp */
    timestamp: Date;

    /** Additional metadata */
    metadata?: Record<string, any>;
}

/**
 * User message interface - for messages from users/humans
 * 
 * @public
 */
export interface UserMessage extends BaseMessage {
    /** Message role - always 'user' */
    role: 'user';

    /** User message content */
    content: string;

    /** Optional user identifier */
    name?: string;
}

/**
 * Assistant message interface - for AI assistant responses
 * 
 * @public
 */
export interface AssistantMessage extends BaseMessage {
    /** Message role - always 'assistant' */
    role: 'assistant';

    /** Assistant response content (can be null when making tool calls) */
    content: string | null;

    /** Function call made by the assistant (if any) - legacy format */
    functionCall?: FunctionCall;

    /** Tool calls made by the assistant (OpenAI tool calling format) */
    toolCalls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
}

/**
 * System message interface - for system instructions and prompts
 * 
 * @public
 */
export interface SystemMessage extends BaseMessage {
    /** Message role - always 'system' */
    role: 'system';

    /** System instruction content */
    content: string;

    /** Optional system message identifier */
    name?: string;
}

/**
 * Tool message interface - for tool execution results
 * 
 * @public
 */
export interface ToolMessage extends BaseMessage {
    /** Message role - always 'tool' */
    role: 'tool';

    /** Tool execution result summary */
    content: string;

    /** Name of the tool that was executed (legacy format) */
    name?: string;

    /** Tool call ID for OpenAI tool calling format */
    toolCallId?: string;

    /** Complete tool execution result (legacy format) */
    toolResult?: FunctionCallResult;
}

/**
 * Universal message type covering all possible message variations
 * 
 * This union type ensures type safety by requiring specific properties
 * based on the message role, preventing invalid combinations.
 * 
 * @see {@link ../../apps/examples/04-sessions | Session and Conversation Examples}
 * 
 * @public
 */
export type UniversalMessage = UserMessage | AssistantMessage | SystemMessage | ToolMessage;

/**
 * Type guard functions for message type checking
 */

/**
 * Check if a message is a user message
 * 
 * @param message - Message to check
 * @returns True if the message is a user message
 */
export function isUserMessage(message: UniversalMessage): message is UserMessage {
    return message.role === 'user';
}

/**
 * Check if a message is an assistant message
 * 
 * @param message - Message to check
 * @returns True if the message is an assistant message
 */
export function isAssistantMessage(message: UniversalMessage): message is AssistantMessage {
    return message.role === 'assistant';
}

/**
 * Check if a message is a system message
 * 
 * @param message - Message to check
 * @returns True if the message is a system message
 */
export function isSystemMessage(message: UniversalMessage): message is SystemMessage {
    return message.role === 'system';
}

/**
 * Check if a message is a tool message
 * 
 * @param message - Message to check
 * @returns True if the message is a tool message
 */
export function isToolMessage(message: UniversalMessage): message is ToolMessage {
    return message.role === 'tool';
}

/**
 * Message factory functions for creating type-safe messages
 */

/**
 * Create a user message
 * 
 * @param content - Message content
 * @param options - Optional message properties
 * @returns Type-safe user message
 */
export function createUserMessage(
    content: string,
    options?: { name?: string; metadata?: Record<string, any> }
): UserMessage {
    return {
        role: 'user',
        content,
        name: options?.name,
        timestamp: new Date(),
        metadata: options?.metadata
    };
}

/**
 * Create an assistant message
 * 
 * @param content - Message content (can be null for tool-only messages)
 * @param options - Optional message properties
 * @returns Type-safe assistant message
 */
export function createAssistantMessage(
    content: string | null,
    options?: {
        functionCall?: FunctionCall;
        toolCalls?: Array<{
            id: string;
            type: 'function';
            function: {
                name: string;
                arguments: string;
            };
        }>;
        metadata?: Record<string, any>;
    }
): AssistantMessage {
    return {
        role: 'assistant',
        content,
        functionCall: options?.functionCall,
        toolCalls: options?.toolCalls,
        timestamp: new Date(),
        metadata: options?.metadata
    };
}

/**
 * Create a system message
 * 
 * @param content - Message content
 * @param options - Optional message properties
 * @returns Type-safe system message
 */
export function createSystemMessage(
    content: string,
    options?: { name?: string; metadata?: Record<string, any> }
): SystemMessage {
    return {
        role: 'system',
        content,
        name: options?.name,
        timestamp: new Date(),
        metadata: options?.metadata
    };
}

/**
 * Create a tool message
 * 
 * @param content - Tool execution result content
 * @param options - Optional message properties (either toolResult for legacy or toolCallId for OpenAI)
 * @returns Type-safe tool message
 */
export function createToolMessage(
    content: string,
    options?: {
        toolResult?: FunctionCallResult;
        toolCallId?: string;
        name?: string;
        metadata?: Record<string, any>;
    }
): ToolMessage {
    return {
        role: 'tool',
        content,
        name: options?.name || options?.toolResult?.name,
        toolCallId: options?.toolCallId,
        toolResult: options?.toolResult,
        timestamp: new Date(),
        metadata: options?.metadata
    };
}

/**
 * Conversation history interface
 * 
 * Interface for managing conversation history, designed in a provider-independent way.
 * Provides type-safe methods for adding different message types and querying the history.
 * 
 * @see {@link ../../apps/examples/04-sessions | Session and Conversation Examples}
 * 
 * @public
 */
export interface ConversationHistory {
    /**
     * Add a message to conversation history
     * 
     * @param message - Universal message to add
     */
    addMessage(message: UniversalMessage): void;

    /**
     * Add user message (convenience method)
     * 
     * @param content - User message content
     * @param metadata - Optional metadata
     */
    addUserMessage(content: string, metadata?: Record<string, any>): void;

    /**
     * Add assistant message (convenience method)
     * 
     * @param content - Assistant response content
     * @param functionCall - Optional function call made by assistant
     * @param metadata - Optional metadata
     */
    addAssistantMessage(content: string, functionCall?: FunctionCall, metadata?: Record<string, any>): void;

    /**
     * Add system message (convenience method)
     * 
     * @param content - System instruction content
     * @param metadata - Optional metadata
     */
    addSystemMessage(content: string, metadata?: Record<string, any>): void;

    /**
     * Add tool execution result message (convenience method)
     * 
     * @param toolResult - Tool execution result
     * @param metadata - Optional metadata
     */
    addToolMessage(toolResult: FunctionCallResult, metadata?: Record<string, any>): void;

    /**
     * Get all messages in chronological order
     * 
     * @returns Array of all messages
     */
    getMessages(): UniversalMessage[];

    /**
     * Get messages filtered by specific role
     * 
     * @param role - Message role to filter by
     * @returns Array of messages with the specified role
     */
    getMessagesByRole(role: UniversalMessageRole): UniversalMessage[];

    /**
     * Get the most recent n messages
     * 
     * @param count - Number of recent messages to return
     * @returns Array of recent messages
     */
    getRecentMessages(count: number): UniversalMessage[];

    /**
     * Clear all conversation history
     */
    clear(): void;

    /**
     * Get total message count
     * 
     * @returns Number of messages in history
     */
    getMessageCount(): number;
}

/**
 * Default conversation history implementation
 * 
 * Provides a simple in-memory storage for conversation messages with optional
 * message count limiting. Supports all message types with type safety.
 * 
 * @see {@link ../../apps/examples/04-sessions | Session and Conversation Examples}
 * 
 * @public
 */
export class SimpleConversationHistory implements ConversationHistory {
    /** @internal Array storing all messages */
    private messages: UniversalMessage[] = [];

    /** @internal Maximum message count (0 = unlimited) */
    private readonly maxMessages: number;

    /**
     * Create a new SimpleConversationHistory instance
     * 
     * @param options - Configuration options
     * @param options.maxMessages - Maximum number of messages to keep (0 = unlimited)
     */
    constructor(options?: { maxMessages?: number }) {
        this.maxMessages = options?.maxMessages || 0;
    }

    /**
     * Add a message to conversation history
     * 
     * Appends the message to the history and applies message count limits if configured.
     * System messages are always preserved when applying limits.
     * 
     * @param message - Universal message to add
     */
    addMessage(message: UniversalMessage): void {
        this.messages.push(message);
        this._applyMessageLimit();
    }

    /**
     * Add user message using type-safe factory
     * 
     * @param content - User message content
     * @param metadata - Optional metadata
     */
    addUserMessage(content: string, metadata?: Record<string, any>): void {
        this.addMessage(createUserMessage(content, { metadata }));
    }

    /**
     * Add assistant message using type-safe factory
     * 
     * @param content - Assistant response content
     * @param functionCall - Optional function call made by assistant
     * @param metadata - Optional metadata
     */
    addAssistantMessage(content: string, functionCall?: FunctionCall, metadata?: Record<string, any>): void {
        this.addMessage(createAssistantMessage(content, { functionCall, metadata }));
    }

    /**
     * Add system message using type-safe factory
     * 
     * @param content - System instruction content
     * @param metadata - Optional metadata
     */
    addSystemMessage(content: string, metadata?: Record<string, any>): void {
        this.addMessage(createSystemMessage(content, { metadata }));
    }

    /**
     * Add tool execution result message using type-safe factory
     * 
     * @param toolResult - Tool execution result
     * @param metadata - Optional metadata
     */
    addToolMessage(toolResult: FunctionCallResult, metadata?: Record<string, any>): void {
        this.addMessage(createToolMessage(toolResult.error ? `Tool execution error: ${toolResult.error}` : `Tool result: ${JSON.stringify(toolResult.result)}`, {
            toolResult,
            name: toolResult.name,
            metadata
        }));
    }

    /**
     * Get all messages in chronological order
     * 
     * @returns Defensive copy of all messages
     */
    getMessages(): UniversalMessage[] {
        return [...this.messages];
    }

    /**
     * Get messages filtered by specific role with type safety
     * 
     * @param role - Message role to filter by
     * @returns Array of messages with the specified role
     */
    getMessagesByRole(role: UniversalMessageRole): UniversalMessage[] {
        return this.messages.filter(msg => msg.role === role);
    }

    /**
     * Get the most recent n messages
     * 
     * @param count - Number of recent messages to return
     * @returns Array of recent messages in chronological order
     */
    getRecentMessages(count: number): UniversalMessage[] {
        return this.messages.slice(-count);
    }

    /**
     * Get total message count
     * 
     * @returns Number of messages currently stored
     */
    getMessageCount(): number {
        return this.messages.length;
    }

    /**
     * Clear all conversation history
     * 
     * Removes all messages from the history.
     */
    clear(): void {
        this.messages = [];
    }

    /**
     * Apply message count limits while preserving system messages
     * 
     * When maxMessages is set and exceeded, this method removes older messages
     * while always preserving system messages which are important for context.
     * 
     * @internal
     */
    private _applyMessageLimit(): void {
        if (this.maxMessages > 0 && this.messages.length > this.maxMessages) {
            // Always keep system messages
            const systemMessages = this.messages.filter(isSystemMessage);
            const nonSystemMessages = this.messages.filter(msg => !isSystemMessage(msg));

            // Apply limit only to non-system messages
            const remainingCount = this.maxMessages - systemMessages.length;
            const trimmedNonSystemMessages = nonSystemMessages.slice(-remainingCount);

            // Combine system messages with limited general messages
            this.messages = [...systemMessages, ...trimmedNonSystemMessages];
        }
    }
}

/**
 * Conversation history implementation that maintains system messages
 * 
 * Extends SimpleConversationHistory with automatic system prompt management.
 * The system prompt is automatically maintained and can be updated dynamically.
 * 
 * @see {@link ../../apps/examples/04-sessions | Session and Conversation Examples}
 * 
 * @public
 */
export class PersistentSystemConversationHistory implements ConversationHistory {
    /** @internal Underlying conversation history */
    private readonly history: SimpleConversationHistory;

    /** @internal Current system prompt */
    private systemPrompt: string;

    /**
     * Create a new PersistentSystemConversationHistory instance
     * 
     * @param systemPrompt - Initial system prompt to set
     * @param options - Configuration options passed to underlying SimpleConversationHistory
     */
    constructor(systemPrompt: string, options?: { maxMessages?: number }) {
        this.history = new SimpleConversationHistory(options);
        this.systemPrompt = systemPrompt;

        // Add initial system message
        this.history.addSystemMessage(this.systemPrompt);
    }

    /**
     * Add a message to conversation history (delegates to underlying history)
     * 
     * @param message - Universal message to add
     */
    addMessage(message: UniversalMessage): void {
        this.history.addMessage(message);
    }

    /**
     * Add user message (delegates to underlying history)
     * 
     * @param content - User message content
     * @param metadata - Optional metadata
     */
    addUserMessage(content: string, metadata?: Record<string, any>): void {
        this.history.addUserMessage(content, metadata);
    }

    /**
     * Add assistant message (delegates to underlying history)
     * 
     * @param content - Assistant response content
     * @param functionCall - Optional function call made by assistant
     * @param metadata - Optional metadata
     */
    addAssistantMessage(content: string, functionCall?: FunctionCall, metadata?: Record<string, any>): void {
        this.history.addAssistantMessage(content, functionCall, metadata);
    }

    /**
     * Add system message (delegates to underlying history)
     * 
     * @param content - System instruction content
     * @param metadata - Optional metadata
     */
    addSystemMessage(content: string, metadata?: Record<string, any>): void {
        this.history.addSystemMessage(content, metadata);
    }

    /**
     * Add tool execution result message (delegates to underlying history)
     * 
     * @param toolResult - Tool execution result
     * @param metadata - Optional metadata
     */
    addToolMessage(toolResult: FunctionCallResult, metadata?: Record<string, any>): void {
        this.history.addToolMessage(toolResult, metadata);
    }

    /**
     * Get all messages (delegates to underlying history)
     * 
     * @returns Array of all messages including system messages
     */
    getMessages(): UniversalMessage[] {
        return this.history.getMessages();
    }

    /**
     * Get messages by role (delegates to underlying history)
     * 
     * @param role - Message role to filter by
     * @returns Array of messages with the specified role
     */
    getMessagesByRole(role: UniversalMessageRole): UniversalMessage[] {
        return this.history.getMessagesByRole(role);
    }

    /**
     * Get recent messages (delegates to underlying history)
     * 
     * @param count - Number of recent messages to return
     * @returns Array of recent messages
     */
    getRecentMessages(count: number): UniversalMessage[] {
        return this.history.getRecentMessages(count);
    }

    /**
     * Get message count (delegates to underlying history)
     * 
     * @returns Total number of messages including system messages
     */
    getMessageCount(): number {
        return this.history.getMessageCount();
    }

    /**
     * Clear conversation history but preserve system prompt
     * 
     * Clears all messages and re-adds the current system prompt.
     */
    clear(): void {
        this.history.clear();
        this.history.addSystemMessage(this.systemPrompt);
    }

    /**
     * Update the system prompt and refresh system messages
     * 
     * Removes old system messages, updates the system prompt, and adds
     * the new system prompt as a system message.
     * 
     * @param systemPrompt - New system prompt to set
     */
    updateSystemPrompt(systemPrompt: string): void {
        this.systemPrompt = systemPrompt;

        // Remove existing system messages
        const messages = this.history.getMessages();
        const nonSystemMessages = messages.filter(msg => !isSystemMessage(msg));

        // Clear history and add new system message
        this.history.clear();
        this.history.addSystemMessage(this.systemPrompt);

        // Re-add non-system messages
        nonSystemMessages.forEach(message => this.history.addMessage(message));
    }

    /**
     * Get the current system prompt
     * 
     * @returns Current system prompt string
     */
    getSystemPrompt(): string {
        return this.systemPrompt;
    }
} 