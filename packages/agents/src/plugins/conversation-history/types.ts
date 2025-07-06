import { Message } from '../../interfaces/agent';
import type { BasePluginOptions } from '../../abstracts/base-plugin';

/**
 * Storage strategy for conversation history
 */
export type HistoryStorageStrategy = 'memory' | 'file' | 'database';

/**
 * Configuration options for conversation history plugin
 */
export interface ConversationHistoryPluginOptions extends BasePluginOptions {
    /** Storage strategy to use */
    storage: HistoryStorageStrategy;
    /** Maximum number of conversations to store */
    maxConversations?: number;
    /** Maximum messages per conversation */
    maxMessagesPerConversation?: number;
    /** File path for file storage strategy */
    filePath?: string;
    /** Database connection string for database storage */
    connectionString?: string;
    /** Whether to auto-save after each message */
    autoSave?: boolean;
    /** Save interval in milliseconds for batch saving */
    saveInterval?: number;
}

/**
 * Conversation history entry
 */
export interface ConversationHistoryEntry {
    conversationId: string;
    messages: Message[];
    startTime: Date;
    lastUpdated: Date;
    metadata?: Record<string, string | number | boolean | Date>;
}

/**
 * Storage interface for conversation history
 */
export interface HistoryStorage {
    save(conversationId: string, entry: ConversationHistoryEntry): Promise<void>;
    load(conversationId: string): Promise<ConversationHistoryEntry | undefined>;
    list(): Promise<string[]>;
    delete(conversationId: string): Promise<boolean>;
    clear(): Promise<void>;
}

/**
 * Conversation history plugin statistics
 */
export interface ConversationHistoryPluginStats {
    /** Total number of conversations stored */
    totalConversations: number;
    /** Total number of messages stored */
    totalMessages: number;
    /** Storage strategy in use */
    storageStrategy: HistoryStorageStrategy;
    /** Last save timestamp */
    lastSaveTime?: Date;
    /** Number of failed saves */
    failedSaves: number;
} 