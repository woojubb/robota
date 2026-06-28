import { createLogger, type ILogger, StorageError } from '@robota-sdk/agent-core';

import type { IHistoryStorage, IConversationHistoryEntry, IDatabaseDriver } from '../types';

const DEFAULT_KEY_PREFIX = 'conversation:';

/**
 * Database-backed conversation history storage. Serializes each conversation to JSON and
 * persists it through an injected {@link IDatabaseDriver} (PLUGIN-002).
 */
export class DatabaseHistoryStorage implements IHistoryStorage {
  private driver: IDatabaseDriver;
  private keyPrefix: string;
  private logger: ILogger;

  constructor(driver: IDatabaseDriver, options: { keyPrefix?: string } = {}) {
    this.driver = driver;
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.logger = createLogger('DatabaseHistoryStorage');
  }

  private key(conversationId: string): string {
    return `${this.keyPrefix}${conversationId}`;
  }

  async save(conversationId: string, entry: IConversationHistoryEntry): Promise<void> {
    try {
      await this.driver.set(this.key(conversationId), JSON.stringify(entry));
    } catch (error) {
      throw new StorageError('Failed to save conversation to database', {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async load(conversationId: string): Promise<IConversationHistoryEntry | undefined> {
    try {
      const raw = await this.driver.get(this.key(conversationId));
      if (raw === undefined) return undefined;
      const entry = JSON.parse(raw) as IConversationHistoryEntry;
      reviveHistoryEntry(entry);
      return entry;
    } catch (error) {
      throw new StorageError('Failed to load conversation from database', {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async list(): Promise<string[]> {
    try {
      const keys = await this.driver.list(this.keyPrefix);
      return keys.map((k) => k.slice(this.keyPrefix.length));
    } catch (error) {
      throw new StorageError('Failed to list conversations from database', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async delete(conversationId: string): Promise<boolean> {
    try {
      return await this.driver.delete(this.key(conversationId));
    } catch (error) {
      throw new StorageError('Failed to delete conversation from database', {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async clear(): Promise<void> {
    try {
      await this.driver.clear(this.keyPrefix);
    } catch (error) {
      throw new StorageError('Failed to clear conversations from database', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Revive Date fields lost to JSON serialization. */
function reviveHistoryEntry(entry: IConversationHistoryEntry): void {
  entry.startTime = new Date(entry.startTime);
  entry.lastUpdated = new Date(entry.lastUpdated);
  for (const message of entry.messages) {
    const dated = message as { timestamp?: string | Date };
    if (dated.timestamp) dated.timestamp = new Date(dated.timestamp);
  }
}
