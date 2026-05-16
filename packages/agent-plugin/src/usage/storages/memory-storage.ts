import { IUsageStorage, IUsageStats, IAggregatedUsageStats } from '../types';
import { aggregateUsageStats } from '../aggregate-usage-stats';

/**
 * Memory storage implementation for usage statistics
 */
export class MemoryUsageStorage implements IUsageStorage {
  private entries: IUsageStats[] = [];
  private maxEntries: number;

  constructor(maxEntries: number = 10000) {
    this.maxEntries = maxEntries;
  }

  async save(entry: IUsageStats): Promise<void> {
    // Remove oldest entries if limit exceeded
    if (this.entries.length >= this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries + 1);
    }

    this.entries.push({ ...entry });
  }

  async getStats(
    conversationId?: string,
    timeRange?: { start: Date; end: Date },
  ): Promise<IUsageStats[]> {
    let filtered = [...this.entries];

    if (conversationId) {
      filtered = filtered.filter((entry) => entry.conversationId === conversationId);
    }

    if (timeRange) {
      filtered = filtered.filter(
        (entry) => entry.timestamp >= timeRange.start && entry.timestamp <= timeRange.end,
      );
    }

    return filtered;
  }

  async getAggregatedStats(timeRange?: { start: Date; end: Date }): Promise<IAggregatedUsageStats> {
    const stats = await this.getStats(undefined, timeRange);
    return aggregateUsageStats(stats, timeRange);
  }

  async clear(): Promise<void> {
    this.entries = [];
  }

  async flush(): Promise<void> {
    // Memory storage doesn't need flushing
  }

  async close(): Promise<void> {
    // Memory storage doesn't need closing
  }

  // Aggregation logic intentionally lives in ../aggregate-usage-stats.ts (SSOT utility).
}
