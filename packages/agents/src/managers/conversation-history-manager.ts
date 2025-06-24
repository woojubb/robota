import { Logger } from '../utils/logger';

/**
 * Message types based on core package structure
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface BaseMessage {
    timestamp: Date;
    metadata?: Record<string, any>;
}

export interface UserMessage extends BaseMessage {
    role: 'user';
    content: string;
    name?: string;
}

export interface AssistantMessage extends BaseMessage {
    role: 'assistant';
    content: string | null;
    toolCalls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
}

export interface SystemMessage extends BaseMessage {
    role: 'system';
    content: string;
    name?: string;
}

export interface ToolMessage extends BaseMessage {
    role: 'tool';
    content: string;
    toolCallId: string;
    name?: string;
}

export type UniversalMessage = UserMessage | AssistantMessage | SystemMessage | ToolMessage;

/**
 * Type guard functions
 */
export function isAssistantMessage(message: UniversalMessage): message is AssistantMessage {
    return message.role === 'assistant';
}

export function isToolMessage(message: UniversalMessage): message is ToolMessage {
    return message.role === 'tool';
}

export function isSystemMessage(message: UniversalMessage): message is SystemMessage {
    return message.role === 'system';
}

/**
 * Message factory functions
 */
export function createUserMessage(content: string, metadata?: Record<string, any>): UserMessage {
    return {
        role: 'user',
        content,
        timestamp: new Date(),
        ...(metadata && { metadata }),
    };
}

export function createAssistantMessage(
    content: string | null,
    toolCalls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
    }>,
    metadata?: Record<string, any>
): AssistantMessage {
    return {
        role: 'assistant',
        content,
        ...(toolCalls && { toolCalls }),
        timestamp: new Date(),
        ...(metadata && { metadata }),
    };
}

export function createSystemMessage(content: string, metadata?: Record<string, any>): SystemMessage {
    return {
        role: 'system',
        content,
        timestamp: new Date(),
        ...(metadata && { metadata }),
    };
}

export function createToolMessage(
    content: string,
    toolCallId: string,
    toolName?: string,
    metadata?: Record<string, any>
): ToolMessage {
    return {
        role: 'tool',
        content,
        toolCallId,
        ...(toolName && { name: toolName }),
        timestamp: new Date(),
        ...(metadata && { metadata }),
    };
}

/**
 * Conversation Session for a single conversation/session
 */
export class ConversationSession {
    private messages: UniversalMessage[] = [];
    private readonly maxMessages: number;

    constructor(maxMessages: number = 100) {
        this.maxMessages = maxMessages;
    }

    /**
     * Add any message to history
     */
    addMessage(message: UniversalMessage): void {
        this.messages.push(message);
        this.applyMessageLimit();
    }

    /**
     * Add user message
     */
    addUserMessage(content: string, metadata?: Record<string, any>): void {
        this.addMessage(createUserMessage(content, metadata));
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
        metadata?: Record<string, any>
    ): void {
        this.addMessage(createAssistantMessage(content, toolCalls, metadata));
    }

    /**
     * Add system message
     */
    addSystemMessage(content: string, metadata?: Record<string, any>): void {
        this.addMessage(createSystemMessage(content, metadata));
    }

    /**
     * Add tool result message
     */
    addToolMessage(content: string, toolCallId: string, toolName?: string, metadata?: Record<string, any>): void {
        this.addMessage(createToolMessage(content, toolCallId, toolName, metadata));
    }

    /**
     * Add tool execution result message with tool call ID (for tool calling format)
     * High-level API matching core package
     */
    addToolMessageWithId(content: string, toolCallId: string, toolName: string, metadata?: Record<string, any>): void {
        this.addMessage(createToolMessage(content, toolCallId, toolName, metadata));
    }

    /**
     * Get all messages in chronological order
     */
    getMessages(): UniversalMessage[] {
        return [...this.messages];
    }

    /**
     * Get messages formatted for API consumption
     */
    getMessagesForAPI(): APIMessage[] {
        return this.messages.map(msg => ({
            role: msg.role,
            content: msg.content,
            ...(isAssistantMessage(msg) && msg.toolCalls ? { tool_calls: msg.toolCalls } : {}),
            ...(isToolMessage(msg) ? { tool_call_id: msg.toolCallId } : {}),
        }));
    }

    /**
     * Get message count
     */
    getMessageCount(): number {
        return this.messages.length;
    }

    /**
     * Clear all messages
     */
    clear(): void {
        this.messages = [];
    }

    /**
     * Apply message limit while preserving system messages
     */
    private applyMessageLimit(): void {
        if (this.maxMessages > 0 && this.messages.length > this.maxMessages) {
            const systemMessages = this.messages.filter(isSystemMessage);
            const nonSystemMessages = this.messages.filter(msg => !isSystemMessage(msg));

            const availableSlots = Math.max(0, this.maxMessages - systemMessages.length);
            const limitedNonSystemMessages = nonSystemMessages.slice(-availableSlots);

            this.messages = [...systemMessages, ...limitedNonSystemMessages];
        }
    }
}

/**
 * API Message format for provider consumption
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
 * Conversation History Options
 */
export interface ConversationHistoryOptions {
    maxMessagesPerConversation?: number;
    maxConversations?: number;
}

/**
 * Instance-based Conversation History for isolated conversation management
 */
export class ConversationHistory {
    private conversations = new Map<string, ConversationSession>();
    private logger: Logger;
    private readonly maxMessagesPerConversation: number;
    private readonly maxConversations: number;

    constructor(options: ConversationHistoryOptions = {}) {
        this.maxMessagesPerConversation = options.maxMessagesPerConversation ?? 100;
        this.maxConversations = options.maxConversations ?? 1000;
        this.logger = new Logger('ConversationHistory');

        this.logger.info('ConversationHistory initialized', {
            maxMessagesPerConversation: this.maxMessagesPerConversation,
            maxConversations: this.maxConversations,
        });
    }

    /**
     * Get or create conversation session for a conversation ID
     */
    getConversationSession(conversationId: string): ConversationSession {
        if (!this.conversations.has(conversationId)) {
            // Check if we need to clean up old conversations
            if (this.conversations.size >= this.maxConversations) {
                this.cleanupOldConversations();
            }

            this.conversations.set(
                conversationId,
                new ConversationSession(this.maxMessagesPerConversation)
            );

            this.logger.debug('Created new conversation session', { conversationId });
        }

        return this.conversations.get(conversationId)!;
    }

    /**
     * Check if conversation exists
     */
    hasConversation(conversationId: string): boolean {
        return this.conversations.has(conversationId);
    }

    /**
     * Remove conversation session
     */
    removeConversation(conversationId: string): boolean {
        const removed = this.conversations.delete(conversationId);
        if (removed) {
            this.logger.debug('Removed conversation session', { conversationId });
        }
        return removed;
    }

    /**
     * Clear all conversation sessions
     */
    clearAll(): void {
        this.conversations.clear();
        this.logger.info('Cleared all conversation sessions');
    }

    /**
     * Get statistics
     */
    getStats(): {
        totalConversations: number;
        conversationIds: string[];
        totalMessages: number;
    } {
        const conversationIds = Array.from(this.conversations.keys());
        const totalMessages = conversationIds.reduce(
            (sum, id) => sum + this.conversations.get(id)!.getMessageCount(),
            0
        );

        return {
            totalConversations: this.conversations.size,
            conversationIds,
            totalMessages,
        };
    }

    /**
     * Clean up oldest conversations when limit is reached
     */
    private cleanupOldConversations(): void {
        const conversationIds = Array.from(this.conversations.keys());
        const toRemove = conversationIds.slice(0, Math.floor(this.maxConversations * 0.1)); // Remove 10%

        toRemove.forEach(id => this.conversations.delete(id));

        this.logger.info('Cleaned up old conversations', {
            removedCount: toRemove.length,
            remainingCount: this.conversations.size,
        });
    }


} 