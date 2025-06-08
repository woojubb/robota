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
 * @param content - Message content
 * @param options - Optional message properties
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
        name: options?.name,
        toolCallId: options?.toolCallId,
        toolResult: options?.toolResult,
        timestamp: new Date(),
        metadata: options?.metadata
    };
}

/**
 * Interface for managing conversation history
 * 
 * This interface provides methods for adding, retrieving, and managing
 * messages in a conversation thread. Implementations may provide
 * different storage mechanisms, message limits, or special handling
 * for specific message types.
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
 * Abstract base class for conversation history implementations
 * 
 * Provides common functionality and message factory methods
 * that can be shared across different conversation history implementations.
 * 
 * @internal
 */
export abstract class BaseConversationHistory implements ConversationHistory {
    /** Maximum number of messages to store (0 = unlimited) */
    protected readonly maxMessages: number;

    constructor(options?: { maxMessages?: number }) {
        this.maxMessages = options?.maxMessages || 0;
    }

    // Abstract methods that must be implemented by subclasses
    abstract addMessage(message: UniversalMessage): void;
    abstract getMessages(): UniversalMessage[];
    abstract clear(): void;
    abstract getMessageCount(): number;

    // Common convenience methods with shared implementation
    addUserMessage(content: string, metadata?: Record<string, any>): void {
        const message = createUserMessage(content, { metadata });
        this.addMessage(message);
    }

    addAssistantMessage(content: string, functionCall?: FunctionCall, metadata?: Record<string, any>): void {
        const message = createAssistantMessage(content, { functionCall, metadata });
        this.addMessage(message);
    }

    addSystemMessage(content: string, metadata?: Record<string, any>): void {
        const message = createSystemMessage(content, { metadata });
        this.addMessage(message);
    }

    addToolMessage(toolResult: FunctionCallResult, metadata?: Record<string, any>): void {
        let content: string;
        if (toolResult.error) {
            content = `Tool execution error: ${toolResult.error}`;
        } else {
            content = `Tool result: ${toolResult.result || 'No result'}`;
        }

        const message = createToolMessage(content, {
            toolResult,
            name: toolResult.name,
            metadata
        });
        this.addMessage(message);
    }

    getMessagesByRole(role: UniversalMessageRole): UniversalMessage[] {
        return this.getMessages().filter(message => message.role === role);
    }

    getRecentMessages(count: number): UniversalMessage[] {
        const messages = this.getMessages();
        return messages.slice(-count);
    }

    /**
 * Apply message limit by removing oldest messages while preserving system messages
 * @internal
 */
    protected applyMessageLimit(messages: UniversalMessage[]): UniversalMessage[] {
        if (this.maxMessages > 0 && messages.length > this.maxMessages) {
            // Separate system messages from other messages
            const systemMessages = messages.filter(isSystemMessage);
            const nonSystemMessages = messages.filter(msg => !isSystemMessage(msg));

            // Calculate how many non-system messages we can keep
            // Total limit minus system messages count
            const availableSlots = Math.max(0, this.maxMessages - systemMessages.length);
            const limitedNonSystemMessages = nonSystemMessages.slice(-availableSlots);

            // Combine system messages with limited non-system messages
            // System messages come first to maintain context
            return [...systemMessages, ...limitedNonSystemMessages];
        }
        return messages;
    }
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
export class SimpleConversationHistory extends BaseConversationHistory {
    /** @internal Array storing all messages */
    private messages: UniversalMessage[] = [];

    /**
     * Create a new SimpleConversationHistory instance
     * 
     * @param options - Configuration options
     * @param options.maxMessages - Maximum number of messages to keep (0 = unlimited)
     */
    constructor(options?: { maxMessages?: number }) {
        super(options);
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
     * Get all messages in chronological order
     * 
     * @returns Defensive copy of all messages
     */
    getMessages(): UniversalMessage[] {
        return [...this.messages];
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
        this.messages = this.applyMessageLimit(this.messages);
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
export class PersistentSystemConversationHistory extends BaseConversationHistory {
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
        super(options);
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
     * Get all messages (delegates to underlying history)
     * 
     * @returns Array of all messages including system messages
     */
    getMessages(): UniversalMessage[] {
        return this.history.getMessages();
    }

    /**
     * Get total message count (delegates to underlying history)
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