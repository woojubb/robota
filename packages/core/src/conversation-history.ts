import type { FunctionCall, FunctionCallResult } from '@robota-sdk/tools';

/**
 * Universal message role type - Provider-independent neutral role
 */
export type UniversalMessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Universal message interface - AI Provider-independent message structure
 */
export interface UniversalMessage {
    /** Message role */
    role: UniversalMessageRole;

    /** Message content */
    content: string;

    /** Message sender name (optional) */
    name?: string;

    /** Function call information (used in assistant messages) */
    functionCall?: FunctionCall;

    /** Tool execution result (used in tool messages) */
    toolResult?: FunctionCallResult;

    /** Message creation time */
    timestamp: Date;

    /** Additional metadata */
    metadata?: Record<string, any>;
}

/**
 * Conversation history interface
 * 
 * Interface for managing conversation history, designed in a neutral form independent of AI Provider
 */
export interface ConversationHistory {
    /**
     * Add message to conversation history
     */
    addMessage(message: UniversalMessage): void;

    /**
     * Add user message (convenience method)
     */
    addUserMessage(content: string, metadata?: Record<string, any>): void;

    /**
     * Add assistant message (convenience method)
     */
    addAssistantMessage(content: string, functionCall?: FunctionCall, metadata?: Record<string, any>): void;

    /**
     * Add system message (convenience method)
     */
    addSystemMessage(content: string, metadata?: Record<string, any>): void;

    /**
     * Add tool execution result message (convenience method)
     */
    addToolMessage(toolResult: FunctionCallResult, metadata?: Record<string, any>): void;

    /**
     * Get all messages
     */
    getMessages(): UniversalMessage[];

    /**
     * Get messages by specific role
     */
    getMessagesByRole(role: UniversalMessageRole): UniversalMessage[];

    /**
     * Get recent n messages
     */
    getRecentMessages(count: number): UniversalMessage[];

    /**
     * Clear conversation history
     */
    clear(): void;

    /**
     * Return message count
     */
    getMessageCount(): number;
}

/**
 * Default conversation history implementation
 */
export class SimpleConversationHistory implements ConversationHistory {
    private messages: UniversalMessage[] = [];
    private maxMessages: number;

    constructor(options?: { maxMessages?: number }) {
        this.maxMessages = options?.maxMessages || 0;
    }

    addMessage(message: UniversalMessage): void {
        this.messages.push(message);
        this._applyMessageLimit();
    }

    addUserMessage(content: string, metadata?: Record<string, any>): void {
        this.addMessage({
            role: 'user',
            content,
            timestamp: new Date(),
            metadata
        });
    }

    addAssistantMessage(content: string, functionCall?: FunctionCall, metadata?: Record<string, any>): void {
        this.addMessage({
            role: 'assistant',
            content,
            functionCall,
            timestamp: new Date(),
            metadata
        });
    }

    addSystemMessage(content: string, metadata?: Record<string, any>): void {
        this.addMessage({
            role: 'system',
            content,
            timestamp: new Date(),
            metadata
        });
    }

    addToolMessage(toolResult: FunctionCallResult, metadata?: Record<string, any>): void {
        const content = toolResult.error
            ? `Tool execution error: ${toolResult.error}`
            : `Tool result: ${JSON.stringify(toolResult.result)}`;

        this.addMessage({
            role: 'tool',
            content,
            name: toolResult.name,
            toolResult,
            timestamp: new Date(),
            metadata
        });
    }

    getMessages(): UniversalMessage[] {
        return [...this.messages];
    }

    getMessagesByRole(role: UniversalMessageRole): UniversalMessage[] {
        return this.messages.filter(msg => msg.role === role);
    }

    getRecentMessages(count: number): UniversalMessage[] {
        return this.messages.slice(-count);
    }

    getMessageCount(): number {
        return this.messages.length;
    }

    clear(): void {
        this.messages = [];
    }

    private _applyMessageLimit(): void {
        if (this.maxMessages > 0 && this.messages.length > this.maxMessages) {
            // Always keep system messages
            const systemMessages = this.messages.filter(m => m.role === 'system');
            const nonSystemMessages = this.messages.filter(m => m.role !== 'system');

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
 */
export class PersistentSystemConversationHistory implements ConversationHistory {
    private history: SimpleConversationHistory;
    private systemPrompt: string;

    constructor(systemPrompt: string, options?: { maxMessages?: number }) {
        this.history = new SimpleConversationHistory(options);
        this.systemPrompt = systemPrompt;

        // Add initial system message
        this.history.addSystemMessage(this.systemPrompt);
    }

    addMessage(message: UniversalMessage): void {
        this.history.addMessage(message);
    }

    addUserMessage(content: string, metadata?: Record<string, any>): void {
        this.history.addUserMessage(content, metadata);
    }

    addAssistantMessage(content: string, functionCall?: FunctionCall, metadata?: Record<string, any>): void {
        this.history.addAssistantMessage(content, functionCall, metadata);
    }

    addSystemMessage(content: string, metadata?: Record<string, any>): void {
        this.history.addSystemMessage(content, metadata);
    }

    addToolMessage(toolResult: FunctionCallResult, metadata?: Record<string, any>): void {
        this.history.addToolMessage(toolResult, metadata);
    }

    getMessages(): UniversalMessage[] {
        return this.history.getMessages();
    }

    getMessagesByRole(role: UniversalMessageRole): UniversalMessage[] {
        return this.history.getMessagesByRole(role);
    }

    getRecentMessages(count: number): UniversalMessage[] {
        return this.history.getRecentMessages(count);
    }

    getMessageCount(): number {
        return this.history.getMessageCount();
    }

    clear(): void {
        this.history.clear();
        // Add initial system message
        this.history.addSystemMessage(this.systemPrompt);
    }

    /**
     * Update system prompt
     */
    updateSystemPrompt(systemPrompt: string): void {
        this.systemPrompt = systemPrompt;

        // Keep only non-system messages
        const nonSystemMessages = this.history.getMessages().filter(m => m.role !== 'system');
        this.history.clear();

        // Add new system message
        this.history.addSystemMessage(this.systemPrompt);

        // Add previous messages again
        for (const message of nonSystemMessages) {
            this.history.addMessage(message);
        }
    }

    /**
     * Return current system prompt
     */
    getSystemPrompt(): string {
        return this.systemPrompt;
    }
} 