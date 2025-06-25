import type { AIProvider, ToolSchema, ChatOptions } from '../interfaces/provider';
import type { UniversalMessage } from '../managers/conversation-history-manager';
import { logger } from '../utils/logger';

/**
 * Base AI Provider abstract class that uses UniversalMessage only
 * This is the provider-agnostic base class that all providers should extend
 */
export abstract class BaseAIProvider implements AIProvider {
    abstract readonly name: string;
    abstract readonly version: string;

    /**
     * Each provider must implement chat using their own native SDK types internally
     * @param messages - Array of UniversalMessage from conversation history
     * @param options - Chat options including tools, model settings, etc.
     * @returns Promise resolving to a UniversalMessage response
     */
    abstract chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage>;

    /**
     * Each provider must implement streaming chat using their own native SDK types internally
     * @param messages - Array of UniversalMessage from conversation history  
     * @param options - Chat options including tools, model settings, etc.
     * @returns AsyncIterable of UniversalMessage chunks
     */
    abstract chatStream?(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage>;

    /**
     * Default implementation - most modern providers support tools
     * @returns true if tool calling is supported
     */
    supportsTools(): boolean {
        return true;
    }

    /**
     * Default implementation - providers can override for specific validation
     * @returns true if configuration is valid
     */
    validateConfig(): boolean {
        return true;
    }

    /**
     * Default implementation - providers can override for cleanup
     */
    async dispose(): Promise<void> {
        // Default: no cleanup needed
    }

    /**
     * Utility method for validating UniversalMessage array
     * @param messages - Messages to validate
     */
    protected validateMessages(messages: UniversalMessage[]): void {
        if (!Array.isArray(messages)) {
            throw new Error('Messages must be an array');
        }

        if (messages.length === 0) {
            throw new Error('Messages array cannot be empty');
        }

        for (const message of messages) {
            if (!message.role || !['user', 'assistant', 'system', 'tool'].includes(message.role)) {
                throw new Error(`Invalid message role: ${message.role}`);
            }
        }
    }

    /**
     * Utility method for validating tool schemas
     * @param tools - Tool schemas to validate
     */
    protected validateTools(tools?: ToolSchema[]): void {
        if (!tools) return;

        if (!Array.isArray(tools)) {
            throw new Error('Tools must be an array');
        }

        for (const tool of tools) {
            if (!tool.name || typeof tool.name !== 'string') {
                throw new Error('Tool must have a valid name');
            }
            if (!tool.description || typeof tool.description !== 'string') {
                throw new Error('Tool must have a valid description');
            }
            if (!tool.parameters || typeof tool.parameters !== 'object') {
                throw new Error('Tool must have valid parameters');
            }
        }
    }

    /**
     * Utility method for logging provider operations
     * @param operation - Operation name
     * @param data - Additional data to log
     */
    protected log(operation: string, data?: any): void {
        logger.debug(`${this.name} Provider: ${operation}`, data);
    }
} 