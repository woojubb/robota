import { createLogger, type ILogger, StorageError } from '@robota-sdk/agent-core';

import type { IPluginTextFileStore } from '../../storage/text-file-store';
import type { IHistoryStorage, IConversationHistoryEntry } from '../types';

/**
 * File-backed conversation history storage.
 *
 * All conversations are persisted as a single JSON object keyed by conversation
 * id at `filePath`, read and written through the injected `store`. Reads/writes
 * are write-through (each mutation rewrites the file), so there is no buffered
 * state to lose.
 */
export class FileHistoryStorage implements IHistoryStorage {
  private filePath: string;
  private store: IPluginTextFileStore;
  private logger: ILogger;

  constructor(filePath: string, store: IPluginTextFileStore) {
    this.filePath = filePath;
    this.store = store;
    this.logger = createLogger('FileHistoryStorage');
  }

  private async readAll(): Promise<Record<string, IConversationHistoryEntry>> {
    const raw = await this.store.readText(this.filePath);
    if (raw === undefined) return {};
    const map = JSON.parse(raw) as Record<string, IConversationHistoryEntry>;
    for (const entry of Object.values(map)) reviveHistoryEntry(entry);
    return map;
  }

  private async writeAll(map: Record<string, IConversationHistoryEntry>): Promise<void> {
    await this.store.writeText(this.filePath, JSON.stringify(map));
  }

  async save(conversationId: string, entry: IConversationHistoryEntry): Promise<void> {
    try {
      const map = await this.readAll();
      map[conversationId] = entry;
      await this.writeAll(map);
    } catch (error) {
      throw new StorageError('Failed to save conversation to file', {
        conversationId,
        filePath: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async load(conversationId: string): Promise<IConversationHistoryEntry | undefined> {
    try {
      const map = await this.readAll();
      return map[conversationId];
    } catch (error) {
      throw new StorageError('Failed to load conversation from file', {
        conversationId,
        filePath: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async list(): Promise<string[]> {
    try {
      return Object.keys(await this.readAll());
    } catch (error) {
      throw new StorageError('Failed to list conversations from file', {
        filePath: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async delete(conversationId: string): Promise<boolean> {
    try {
      const map = await this.readAll();
      if (!(conversationId in map)) return false;
      delete map[conversationId];
      await this.writeAll(map);
      return true;
    } catch (error) {
      throw new StorageError('Failed to delete conversation from file', {
        conversationId,
        filePath: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async clear(): Promise<void> {
    try {
      await this.writeAll({});
    } catch (error) {
      throw new StorageError('Failed to clear conversations from file', {
        filePath: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Revive Date fields lost to JSON serialization (timestamps round-trip as ISO strings). */
function reviveHistoryEntry(entry: IConversationHistoryEntry): void {
  entry.startTime = new Date(entry.startTime);
  entry.lastUpdated = new Date(entry.lastUpdated);
  for (const message of entry.messages) {
    const dated = message as { timestamp?: string | Date };
    if (dated.timestamp) dated.timestamp = new Date(dated.timestamp);
  }
}
