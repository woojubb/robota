import { createLogger, type ILogger, StorageError } from '@robota-sdk/agent-core';

import { aggregateUsageStats } from '../aggregate-usage-stats';

import type { IPluginTextFileStore } from '../../storage/text-file-store';
import type { IUsageStorage, IUsageStats, IAggregatedUsageStats } from '../types';

/**
 * File-backed usage-statistics storage.
 *
 * Records are persisted as a single JSON array at `filePath`, read and written
 * through the injected `store`. Writes are write-through (each `save` rewrites
 * the file), so `flush`/`close` have no buffered state to drain.
 */
export class FileUsageStorage implements IUsageStorage {
  private filePath: string;
  private store: IPluginTextFileStore;
  private logger: ILogger;

  constructor(filePath: string, store: IPluginTextFileStore) {
    this.filePath = filePath;
    this.store = store;
    this.logger = createLogger('FileUsageStorage');
  }

  private async readAll(): Promise<IUsageStats[]> {
    const raw = await this.store.readText(this.filePath);
    if (raw === undefined) return [];
    const stats = JSON.parse(raw) as IUsageStats[];
    for (const stat of stats) stat.timestamp = new Date(stat.timestamp);
    return stats;
  }

  private async writeAll(stats: IUsageStats[]): Promise<void> {
    await this.store.writeText(this.filePath, JSON.stringify(stats));
  }

  async save(entry: IUsageStats): Promise<void> {
    try {
      const stats = await this.readAll();
      stats.push(entry);
      await this.writeAll(stats);
    } catch (error) {
      throw new StorageError('Failed to save usage stats to file', {
        filePath: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getStats(
    conversationId?: string,
    timeRange?: { start: Date; end: Date },
  ): Promise<IUsageStats[]> {
    try {
      let stats = await this.readAll();
      if (conversationId) {
        stats = stats.filter((s) => s.conversationId === conversationId);
      }
      if (timeRange) {
        stats = stats.filter((s) => s.timestamp >= timeRange.start && s.timestamp <= timeRange.end);
      }
      return stats;
    } catch (error) {
      throw new StorageError('Failed to load usage stats from file', {
        filePath: this.filePath,
        conversationId: conversationId || 'all',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getAggregatedStats(timeRange?: { start: Date; end: Date }): Promise<IAggregatedUsageStats> {
    try {
      const stats = await this.getStats(undefined, timeRange);
      return aggregateUsageStats(stats, timeRange);
    } catch (error) {
      throw new StorageError('Failed to get aggregated usage stats from file', {
        filePath: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async clear(): Promise<void> {
    try {
      await this.writeAll([]);
    } catch (error) {
      throw new StorageError('Failed to clear usage stats from file', {
        filePath: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async flush(): Promise<void> {
    // Write-through storage: every save is persisted immediately, so there is no
    // buffered state to flush. Method retained to satisfy IUsageStorage.
    this.logger.debug('FileUsageStorage.flush is a no-op (write-through)', {
      filePath: this.filePath,
    });
  }

  async close(): Promise<void> {
    // No long-lived file handle is held between operations.
    this.logger.debug('FileUsageStorage.close is a no-op (no open handle)', {
      filePath: this.filePath,
    });
  }
}
