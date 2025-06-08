import type { UniversalMessage } from '@robota-sdk/core';

/**
 * Interface for conversation history implementations in session management
 * 
 * Defines the contract for storing and retrieving conversation messages
 * within a session context. Implementations can vary from simple in-memory
 * storage to persistent database solutions.
 * 
 * @public
 */
export interface ConversationHistoryInterface {
    /**
     * Add a message to the conversation history
     * 
     * @param message - Universal message to add
     */
    addMessage(message: UniversalMessage): void;

    /**
     * Get all messages in chronological order
     * 
     * @returns Array of all conversation messages
     */
    getMessages(): UniversalMessage[];

    /**
     * Get the total number of messages in the conversation
     * 
     * @returns Current message count
     */
    getMessageCount(): number;

    /**
     * Clear all messages from the conversation history
     */
    clear(): void;

    /**
     * Get the most recent message
     * 
     * @returns Last message or null if empty
     */
    getLastMessage(): UniversalMessage | null;

    /**
     * Get the most recent user message
     * 
     * @returns Last user message or null if none exist
     */
    getLastUserMessage(): UniversalMessage | null;

    /**
     * Get the most recent assistant message
     * 
     * @returns Last assistant message or null if none exist
     */
    getLastAssistantMessage(): UniversalMessage | null;
}

/**
 * Configuration options for conversation history implementations
 * 
 * @public
 */
export interface ConversationHistoryOptions {
    /** Maximum number of messages to retain (0 = unlimited) */
    maxMessages?: number;

    /** Enable metadata storage and retrieval */
    enableMetadata?: boolean;

    /** Enable automatic timestamp generation */
    enableTimestamps?: boolean;
} 