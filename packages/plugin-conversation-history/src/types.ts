import type { TUniversalMessage, IPluginOptions, IPluginStats } from '@robota-sdk/agents';

/**
 * Storage strategy for conversation history
 */
export type THistoryStorageStrategy = 'memory' | 'file' | 'database';

/**
 * Configuration options for conversation history plugin
 */
export interface IConversationHistoryPluginOptions extends IPluginOptions {
  /** Storage strategy to use */
  storage: THistoryStorageStrategy;
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
export interface IConversationHistoryEntry {
  conversationId: string;
  messages: TUniversalMessage[];
  startTime: Date;
  lastUpdated: Date;
  metadata?: Record<string, string | number | boolean | Date>;
}

/**
 * Storage interface for conversation history
 */
export interface IHistoryStorage {
  save(conversationId: string, entry: IConversationHistoryEntry): Promise<void>;
  load(conversationId: string): Promise<IConversationHistoryEntry | undefined>;
  list(): Promise<string[]>;
  delete(conversationId: string): Promise<boolean>;
  clear(): Promise<void>;
}

/**
 * Conversation history plugin statistics
 */
export interface IConversationHistoryPluginStats extends IPluginStats {
  /** Total number of conversations stored */
  totalConversations: number;
  /** Total number of messages stored */
  totalMessages: number;
  /** Storage strategy in use */
  storageStrategy: THistoryStorageStrategy;
  /** Last save timestamp */
  lastSaveTime?: Date;
  /** Number of failed saves */
  failedSaves: number;
}
