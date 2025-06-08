import type { UniversalMessage } from '@robota-sdk/core';

/**
 * Interface for managing system messages within a session context
 * 
 * System messages provide context and instructions to AI models,
 * setting the behavior and personality for conversation sessions.
 * 
 * @public
 */
export interface SystemMessageManager {
    /**
     * Set a single system prompt, replacing any existing system messages
     * 
     * @param prompt - System instruction content
     */
    setSystemPrompt(prompt: string): void;

    /**
     * Add an additional system message to existing ones
     * 
     * @param content - System message content to add
     */
    addSystemMessage(content: string): void;

    /**
     * Get all system messages
     * 
     * @returns Array of system messages in order
     */
    getSystemMessages(): UniversalMessage[];

    /**
     * Clear all system messages
     */
    clearSystemMessages(): void;

    /**
     * Check if any system messages are configured
     * 
     * @returns True if system messages exist
     */
    hasSystemMessages(): boolean;
}

/**
 * Default implementation of system message management for sessions
 * 
 * Provides in-memory storage and management of system messages
 * with support for both single prompt and multiple message scenarios.
 * 
 * @public
 */
export class SystemMessageManagerImpl implements SystemMessageManager {
    /** @internal Array storing system messages */
    private systemMessages: UniversalMessage[] = [];

    /**
     * Set a single system prompt, replacing any existing system messages
     * 
     * This is useful for setting the primary behavior context for a session.
     * 
     * @param prompt - System instruction content
     */
    setSystemPrompt(prompt: string): void {
        this.systemMessages = [{
            role: 'system',
            content: prompt,
            timestamp: new Date()
        }];
    }

    /**
     * Add an additional system message to existing ones
     * 
     * This allows for layered system instructions, useful for adding
     * context-specific guidance while maintaining base instructions.
     * 
     * @param content - System message content to add
     */
    addSystemMessage(content: string): void {
        this.systemMessages.push({
            role: 'system',
            content,
            timestamp: new Date()
        });
    }

    /**
     * Get all system messages
     * 
     * @returns Copy of all system messages in chronological order
     */
    getSystemMessages(): UniversalMessage[] {
        return [...this.systemMessages];
    }

    /**
     * Clear all system messages
     * 
     * Removes all system context, returning to a clean state.
     */
    clearSystemMessages(): void {
        this.systemMessages = [];
    }

    /**
     * Check if any system messages are configured
     * 
     * @returns True if one or more system messages exist
     */
    hasSystemMessages(): boolean {
        return this.systemMessages.length > 0;
    }
} 