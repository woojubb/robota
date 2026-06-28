import type { TUniversalMessage, IPluginOptions, IPluginStats } from '@robota-sdk/agent-core';

/**
 * Storage strategy for conversation history
 */
export type THistoryStorageStrategy = 'memory' | 'file' | 'database';

/**
 * Minimal key/value persistence contract a database backend must satisfy (PLUGIN-002).
 *
 * agent-plugin stays driver-free: the consumer injects a concrete `IDatabaseDriver`
 * (Postgres, SQLite, Redis, …) so no specific DB dependency is bundled here.
 */
export interface IDatabaseDriver {
  /** Return the stored value for `key`, or `undefined` if absent. */
  get(key: string): Promise<string | undefined>;
  /** Persist `value` under `key`. */
  set(key: string, value: string): Promise<void>;
  /** Delete `key`; resolve `true` if it existed. */
  delete(key: string): Promise<boolean>;
  /** Return all keys beginning with `prefix`. */
  list(prefix: string): Promise<string[]>;
  /** Delete all keys beginning with `prefix`. */
  clear(prefix: string): Promise<void>;
}

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
  /** Database connection string for database storage (informational; the driver owns the connection) */
  connectionString?: string;
  /** Injected database driver — required when `storage: 'database'` (PLUGIN-002). */
  databaseDriver?: IDatabaseDriver;
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
