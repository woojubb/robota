import { Logger, createLogger } from '../utils/logger';

/**
 * Universal message role type - Provider-independent neutral role
 * 
 * @public
 */
export type UniversalMessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Message metadata type following semantic naming conventions
 * Supports common message metadata properties
 * 
 * @public
 */
export type ConversationMessageMetadata = Record<string, string | number | boolean | Date | string[] | number[]>;

/**
 * Base interface for all message types
 * 
 * @public
 */
export interface BaseMessage {
    /** Message creation timestamp */
    timestamp: Date;
    /** Additional metadata */
    metadata?: ConversationMessageMetadata;
}

/**
 * User message type
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
 * Assistant message type
 * 
 * @public
 */
export interface AssistantMessage extends BaseMessage {
    /** Message role - always 'assistant' */
    role: 'assistant';
    /** Assistant response content (can be null when making tool calls) */
    content: string | null;
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
 * System message type
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
 * Tool message type
 * 
 * @public
 */
export interface ToolMessage extends BaseMessage {
    /** Message role - always 'tool' */
    role: 'tool';
    /** Tool execution result summary */
    content: string;
    /** Tool call ID for OpenAI tool calling format */
    toolCallId: string;
    /** Name of the tool that was executed */
    name?: string;
}

/**
 * Universal message type covering all possible message variations
 * 
 * This union type ensures type safety by requiring specific properties
 * based on the message role, preventing invalid combinations.
 * 
 * @public
 */
export type UniversalMessage = UserMessage | AssistantMessage | SystemMessage | ToolMessage;

/**
 * Type guard functions
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
    options?: { name?: string; metadata?: ConversationMessageMetadata }
): UserMessage {
    const message: UserMessage = {
        role: 'user',
        content,
        timestamp: new Date()
    };

    if (options?.name) {
        message.name = options.name;
    }

    if (options?.metadata) {
        message.metadata = options.metadata;
    }

    return message;
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
        toolCalls?: Array<{
            id: string;
            type: 'function';
            function: {
                name: string;
                arguments: string;
            };
        }>;
        metadata?: ConversationMessageMetadata;
    }
): AssistantMessage {
    const message: AssistantMessage = {
        role: 'assistant',
        content,
        timestamp: new Date()
    };

    if (options?.toolCalls) {
        message.toolCalls = options.toolCalls;
    }

    if (options?.metadata) {
        message.metadata = options.metadata;
    }

    return message;
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
    options?: { name?: string; metadata?: ConversationMessageMetadata }
): SystemMessage {
    const message: SystemMessage = {
        role: 'system',
        content,
        timestamp: new Date()
    };

    if (options?.name) {
        message.name = options.name;
    }

    if (options?.metadata) {
        message.metadata = options.metadata;
    }

    return message;
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
    options: {
        toolCallId: string;
        name?: string;
        metadata?: ConversationMessageMetadata;
    }
): ToolMessage {
    const message: ToolMessage = {
        role: 'tool',
        content,
        toolCallId: options.toolCallId,
        timestamp: new Date()
    };

    if (options.name) {
        message.name = options.name;
    }

    if (options.metadata) {
        message.metadata = options.metadata;
    }

    return message;
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
export interface ConversationHistoryInterface {
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
    addUserMessage(content: string, metadata?: ConversationMessageMetadata): void;

    /**
     * Add assistant message (convenience method)
     * 
     * @param content - Assistant response content
     * @param toolCalls - Optional tool calls made by assistant
     * @param metadata - Optional metadata
     */
    addAssistantMessage(
        content: string | null,
        toolCalls?: Array<{
            id: string;
            type: 'function';
            function: {
                name: string;
                arguments: string;
            };
        }>,
        metadata?: ConversationMessageMetadata
    ): void;

    /**
     * Add system message (convenience method)
     * 
     * @param content - System instruction content
     * @param metadata - Optional metadata
     */
    addSystemMessage(content: string, metadata?: ConversationMessageMetadata): void;

    /**
     * Add tool execution result message with tool call ID (for tool calling format)
     * 
     * @param content - Tool result content
     * @param toolCallId - Tool call ID from the assistant's tool call
     * @param toolName - Name of the tool that was executed
     * @param metadata - Optional metadata
     */
    addToolMessageWithId(content: string, toolCallId: string, toolName: string, metadata?: ConversationMessageMetadata): void;

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
 * @public
 */
export abstract class BaseConversationHistory implements ConversationHistoryInterface {
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
    addUserMessage(content: string, metadata?: ConversationMessageMetadata): void {
        const options: { name?: string; metadata?: ConversationMessageMetadata } = {};
        if (metadata) {
            options.metadata = metadata;
        }
        const message = createUserMessage(content, options);
        this.addMessage(message);
    }

    addAssistantMessage(
        content: string | null,
        toolCalls?: Array<{
            id: string;
            type: 'function';
            function: {
                name: string;
                arguments: string;
            };
        }>,
        metadata?: ConversationMessageMetadata
    ): void {
        const options: {
            toolCalls?: Array<{
                id: string;
                type: 'function';
                function: {
                    name: string;
                    arguments: string;
                };
            }>;
            metadata?: ConversationMessageMetadata;
        } = {};
        if (toolCalls) {
            options.toolCalls = toolCalls;
        }
        if (metadata) {
            options.metadata = metadata;
        }
        const message = createAssistantMessage(content, options);
        this.addMessage(message);
    }

    addSystemMessage(content: string, metadata?: ConversationMessageMetadata): void {
        const options: { name?: string; metadata?: ConversationMessageMetadata } = {};
        if (metadata) {
            options.metadata = metadata;
        }
        const message = createSystemMessage(content, options);
        this.addMessage(message);
    }

    addToolMessageWithId(content: string, toolCallId: string, toolName: string, metadata?: ConversationMessageMetadata): void {
        const options: {
            toolCallId: string;
            name?: string;
            metadata?: ConversationMessageMetadata;
        } = {
            toolCallId,
            name: toolName
        };
        if (metadata) {
            options.metadata = metadata;
        }
        const message = createToolMessage(content, options);
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
 * Persistent system conversation history implementation
 * 
 * Extends SimpleConversationHistory with persistent system prompt functionality.
 * The system prompt is automatically managed and preserved across operations.
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
     * @param systemPrompt - Initial system prompt
     * @param options - Configuration options
     */
    constructor(systemPrompt: string, options?: { maxMessages?: number }) {
        super(options);
        this.systemPrompt = systemPrompt;
        this.history = new SimpleConversationHistory(options);

        // Initialize with system message
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
     * Get current system prompt
     * 
     * @returns Current system prompt string
     */
    getSystemPrompt(): string {
        return this.systemPrompt;
    }
}

/**
 * Conversation Session for a single conversation/session with enhanced features
 * 
 * Implements ConversationHistoryInterface with additional features like
 * duplicate prevention and API format conversion.
 * 
 * @public
 */
export class ConversationSession implements ConversationHistoryInterface {
    private history: SimpleConversationHistory;

    constructor(maxMessages: number = 100) {
        this.history = new SimpleConversationHistory({ maxMessages });
    }

    /**
     * Add any message to history
     */
    addMessage(message: UniversalMessage): void {
        this.history.addMessage(message);
    }

    /**
     * Add user message
     */
    addUserMessage(content: string, metadata?: ConversationMessageMetadata): void {
        this.history.addUserMessage(content, metadata);
    }

    /**
     * Add assistant message with optional tool calls
     */
    addAssistantMessage(
        content: string | null,
        toolCalls?: Array<{
            id: string;
            type: 'function';
            function: { name: string; arguments: string };
        }>,
        metadata?: ConversationMessageMetadata
    ): void {
        this.history.addAssistantMessage(content, toolCalls, metadata);
    }

    /**
     * Add system message
     */
    addSystemMessage(content: string, metadata?: ConversationMessageMetadata): void {
        this.history.addSystemMessage(content, metadata);
    }

    /**
     * Add tool result message
     */
    addToolMessage(content: string, toolCallId: string, toolName?: string, metadata?: ConversationMessageMetadata): void {
        this.history.addToolMessageWithId(content, toolCallId, toolName || 'unknown', metadata);
    }

    /**
     * Add tool execution result message with tool call ID (for tool calling format)
     * High-level API matching core package with duplicate prevention
     * 
     * Throws error if a tool message with the same toolCallId already exists.
     */
    addToolMessageWithId(content: string, toolCallId: string, toolName: string, metadata?: ConversationMessageMetadata): void {
        // Check if a tool message with this toolCallId already exists
        const existingToolMessage = this.history.getMessages().find(
            msg => msg.role === 'tool' && isToolMessage(msg) && msg.toolCallId === toolCallId
        );

        // Throw error if duplicate toolCallId is detected
        if (existingToolMessage) {
            throw new Error(`Duplicate tool message detected for toolCallId: ${toolCallId}. Tool messages must have unique toolCallIds.`);
        }

        this.history.addToolMessageWithId(content, toolCallId, toolName, metadata);
    }

    /**
     * Get all messages in chronological order
     */
    getMessages(): UniversalMessage[] {
        return this.history.getMessages();
    }

    /**
     * Get messages filtered by specific role
     */
    getMessagesByRole(role: UniversalMessageRole): UniversalMessage[] {
        return this.history.getMessagesByRole(role);
    }

    /**
     * Get the most recent n messages
     */
    getRecentMessages(count: number): UniversalMessage[] {
        return this.history.getRecentMessages(count);
    }

    /**
     * Get messages formatted for API consumption
     */
    getMessagesForAPI(): APIMessage[] {
        return this.history.getMessages().map(msg => {
            const apiMsg: APIMessage = {
                role: msg.role,
                content: msg.content
            };

            if (msg.role === 'assistant' && isAssistantMessage(msg) && msg.toolCalls) {
                apiMsg.tool_calls = msg.toolCalls;
            }

            if (msg.role === 'tool' && isToolMessage(msg)) {
                apiMsg.tool_call_id = msg.toolCallId;
            }

            return apiMsg;
        });
    }

    /**
     * Get total message count
     */
    getMessageCount(): number {
        return this.history.getMessageCount();
    }

    /**
     * Clear all conversation history
     */
    clear(): void {
        this.history.clear();
    }
}

/**
 * API message format for provider consumption
 */
export interface APIMessage {
    role: string;
    content: string | null;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
}

/**
 * Configuration options for ConversationHistory manager
 */
export interface ConversationHistoryOptions {
    maxMessagesPerConversation?: number;
    maxConversations?: number;
}

/**
 * Multi-session conversation history manager
 * 
 * Manages multiple conversation sessions identified by conversation IDs.
 * Provides session isolation and resource management.
 * 
 * @public
 */
export class ConversationHistory {
    private conversations = new Map<string, ConversationSession>();
    private logger: Logger;
    private readonly maxMessagesPerConversation: number;
    private readonly maxConversations: number;

    constructor(options: ConversationHistoryOptions = {}) {
        this.maxMessagesPerConversation = options.maxMessagesPerConversation || 100;
        this.maxConversations = options.maxConversations || 50;
        this.logger = createLogger('ConversationHistory');
    }

    /**
     * Get or create a conversation session
     * 
     * @param conversationId - Unique conversation identifier
     * @returns ConversationSession instance
     */
    getConversationSession(conversationId: string): ConversationSession {
        if (!this.conversations.has(conversationId)) {
            // Clean up if we've reached the conversation limit
            if (this.conversations.size >= this.maxConversations) {
                this.cleanupOldConversations();
            }

            const session = new ConversationSession(this.maxMessagesPerConversation);
            this.conversations.set(conversationId, session);

            this.logger.debug('Created new conversation session', {
                conversationId,
                totalConversations: this.conversations.size
            });
        }

        return this.conversations.get(conversationId)!;
    }

    /**
     * Check if a conversation exists
     * 
     * @param conversationId - Conversation identifier to check
     * @returns True if conversation exists
     */
    hasConversation(conversationId: string): boolean {
        return this.conversations.has(conversationId);
    }

    /**
     * Remove a specific conversation
     * 
     * @param conversationId - Conversation identifier to remove
     * @returns True if conversation was removed, false if not found
     */
    removeConversation(conversationId: string): boolean {
        const removed = this.conversations.delete(conversationId);
        if (removed) {
            this.logger.debug('Removed conversation', { conversationId });
        }
        return removed;
    }

    /**
     * Clear all conversations
     */
    clearAll(): void {
        const count = this.conversations.size;
        this.conversations.clear();
        this.logger.debug('Cleared all conversations', { removedCount: count });
    }

    /**
     * Get conversation statistics
     * 
     * @returns Statistics about managed conversations
     */
    getStats(): {
        totalConversations: number;
        conversationIds: string[];
        totalMessages: number;
    } {
        const conversationIds = Array.from(this.conversations.keys());
        const totalMessages = Array.from(this.conversations.values())
            .reduce((sum, session) => sum + session.getMessageCount(), 0);

        return {
            totalConversations: this.conversations.size,
            conversationIds,
            totalMessages
        };
    }

    /**
     * Clean up old conversations when limit is reached
     * 
     * @internal
     */
    private cleanupOldConversations(): void {
        if (this.conversations.size === 0) return;

        // Remove the oldest conversation (first entry)
        const firstKey = this.conversations.keys().next().value;
        if (firstKey) {
            this.conversations.delete(firstKey);
            this.logger.debug('Cleaned up old conversation', {
                removedConversationId: firstKey,
                remainingConversations: this.conversations.size
            });
        }
    }
} 