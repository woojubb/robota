/**
 * Conversation Service Local Types
 * 
 * Local type definitions for conversation services.
 * These types are used within this conversation service and don't need to be shared globally.
 */

/**
 * Message metadata for conversation context
 * Used for storing additional information with conversation messages
 */
export type TUniversalMessageMetadata = Record<string, string | number | boolean>;

/**
 * Provider-specific metadata format
 * Used when converting metadata for AI provider APIs
 */
export type TProviderMetadata = Record<string, string | number | boolean>;

/**
 * Execution context metadata
 * Used for tracking execution-related information in conversations
 */
export interface IExecutionContextMetadata {
    executionId?: string;
    round?: number;
    timestamp?: Date;
    agentId?: string;
}

/**
 * Tool execution metadata
 * Used for storing tool-related information in conversations
 */
export interface IToolExecutionMetadata {
    toolId?: string;
    executionTime?: number;
    success?: boolean;
    errorMessage?: string;
}