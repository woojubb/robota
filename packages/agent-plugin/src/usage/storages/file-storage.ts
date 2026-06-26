import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { createLogger, type ILogger, StorageError } from '@robota-sdk/agent-core';

import { aggregateUsageStats } from '../aggregate-usage-stats';

import type { IUsageStorage, IUsageStats, IAggregatedUsageStats } from '../types';

/**
 * File-backed usage-statistics storage.
 *
 * Records are persisted as a single JSON array at `filePath`. Writes are
 * write-through (each `save` rewrites the file), so `flush`/`close` have no
 * buffered state to drain.
 */
export class FileUsageStorage implements IUsageStorage {
  private filePath: string;
  private logger: ILogger;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.logger = createLogger('FileUsageStorage');
  }

  private async readAll(): Promise<IUsageStats[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const stats = JSON.parse(raw) as IUsageStats[];
      for (const stat of stats) stat.timestamp = new Date(stat.timestamp);
      return stats;
    } catch (error) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async writeAll(stats: IUsageStats[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(stats), 'utf8');
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
