import type { UniversalMessage } from '@robota-sdk/core';
import { ConversationHistoryInterface } from '../interfaces/conversation-history';

/**
 * Simple in-memory conversation history implementation for session management
 * 
 * Provides basic conversation storage with optional message limiting.
 * Suitable for lightweight session scenarios where conversation persistence
 * is not required beyond the current session lifecycle.
 * 
 * @see {@link ../../../apps/examples/04-sessions | Session Examples}
 * 
 * @public
 */
export class SimpleConversationHistory implements ConversationHistoryInterface {
    /** @internal Array storing conversation messages */
    private messages: UniversalMessage[] = [];

    /** @internal Maximum number of messages to retain */
    private maxMessages?: number;

    /**
     * Create a new simple conversation history instance
     * 
     * @param maxMessages - Optional maximum number of messages to retain.
     *                      When exceeded, oldest messages are automatically removed.
     */
    constructor(maxMessages?: number) {
        this.maxMessages = maxMessages;
    }

    /**
     * Add a message to the conversation history
     * 
     * Automatically applies message limiting if configured.
     * 
     * @param message - Universal message to add to the conversation
     */
    addMessage(message: UniversalMessage): void {
        this.messages.push(message);

        if (this.maxMessages && this.messages.length > this.maxMessages) {
            this.messages = this.messages.slice(-this.maxMessages);
        }
    }

    /**
     * Get all messages in the conversation
     * 
     * @returns Copy of all messages in chronological order
     */
    getMessages(): UniversalMessage[] {
        return [...this.messages];
    }

    /**
     * Get the total number of messages in the conversation
     * 
     * @returns Current message count
     */
    getMessageCount(): number {
        return this.messages.length;
    }

    /**
     * Clear all messages from the conversation history
     */
    clear(): void {
        this.messages = [];
    }

    /**
     * Get the most recent message in the conversation
     * 
     * @returns Last message or null if conversation is empty
     */
    getLastMessage(): UniversalMessage | null {
        return this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
    }

    /**
     * Get the most recent user message in the conversation
     * 
     * Searches backwards through the conversation to find the latest user message.
     * 
     * @returns Last user message or null if no user messages exist
     */
    getLastUserMessage(): UniversalMessage | null {
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i].role === 'user') {
                return this.messages[i];
            }
        }
        return null;
    }

    /**
     * Get the most recent assistant message in the conversation
     * 
     * Searches backwards through the conversation to find the latest assistant message.
     * 
     * @returns Last assistant message or null if no assistant messages exist
     */
    getLastAssistantMessage(): UniversalMessage | null {
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i].role === 'assistant') {
                return this.messages[i];
            }
        }
        return null;
    }
} 