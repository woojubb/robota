import {
  createLogger,
  type ILogger,
  StorageError,
  type TTimerId,
  startPeriodicTask,
  stopPeriodicTask,
} from '@robota-sdk/agent-core';

import { aggregateUsageStats } from '../aggregate-usage-stats';

import type { IUsageStorage, IUsageStats, IAggregatedUsageStats } from '../types';

/**
 * Remote storage for usage statistics with batching.
 *
 * Uses a generic JSON REST contract against `apiUrl`:
 * - `POST   {apiUrl}`  body `{ stats }` — persist a flushed batch
 * - `GET    {apiUrl}?conversationId=&start=&end=` → `{ stats } | IUsageStats[]`
 * - `DELETE {apiUrl}` — clear
 * A bearer `apiKey` and extra `headers` are attached when provided.
 */
export class RemoteUsageStorage implements IUsageStorage {
  private apiUrl: string;
  private apiKey: string;
  private timeout: number;
  private headers: Record<string, string>;
  private batchSize: number;
  private flushInterval: number;
  private batch: IUsageStats[] = [];
  private timer?: TTimerId;
  private logger: ILogger;

  constructor(
    apiUrl: string,
    apiKey: string,
    timeout: number,
    headers: Record<string, string> = {},
    batchSize: number = 50,
    flushInterval: number = 60000, // 1 minute
  ) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.timeout = timeout;
    this.headers = headers;
    this.batchSize = batchSize;
    this.flushInterval = flushInterval;
    this.logger = createLogger('RemoteUsageStorage');

    this.timer = startPeriodicTask(
      this.logger,
      { name: 'RemoteUsageStorage.flush', intervalMs: this.flushInterval },
      async () => {
        await this.flush();
      },
    );
  }

  private requestHeaders(): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      ...this.headers,
    };
  }

  private signal(): AbortSignal | undefined {
    return this.timeout > 0 ? AbortSignal.timeout(this.timeout) : undefined;
  }

  async save(entry: IUsageStats): Promise<void> {
    this.batch.push(entry);

    if (this.batch.length >= this.batchSize) {
      await this.flush();
    }
  }

  async getStats(
    conversationId?: string,
    timeRange?: { start: Date; end: Date },
  ): Promise<IUsageStats[]> {
    try {
      const url = new URL(this.apiUrl);
      if (conversationId) url.searchParams.set('conversationId', conversationId);
      if (timeRange) {
        url.searchParams.set('start', timeRange.start.toISOString());
        url.searchParams.set('end', timeRange.end.toISOString());
      }
      const response = await fetch(url, {
        method: 'GET',
        headers: this.requestHeaders(),
        signal: this.signal(),
      });
      if (!response.ok) {
        throw new Error(`Remote endpoint returned ${response.status}`);
      }
      const body = (await response.json()) as IUsageStats[] | { stats: IUsageStats[] };
      const stats = Array.isArray(body) ? body : body.stats;
      for (const stat of stats) stat.timestamp = new Date(stat.timestamp);
      return stats;
    } catch (error) {
      throw new StorageError('Failed to get usage stats from remote endpoint', {
        endpoint: this.apiUrl,
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
      throw new StorageError('Failed to get aggregated usage stats from remote endpoint', {
        endpoint: this.apiUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async clear(): Promise<void> {
    try {
      const response = await fetch(this.apiUrl, {
        method: 'DELETE',
        headers: this.requestHeaders(),
        signal: this.signal(),
      });
      if (!response.ok) {
        throw new Error(`Remote endpoint returned ${response.status}`);
      }
    } catch (error) {
      throw new StorageError('Failed to clear usage stats from remote endpoint', {
        endpoint: this.apiUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    const statsToSend = [...this.batch];
    this.batch = [];

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: this.requestHeaders(),
        body: JSON.stringify({ stats: statsToSend }),
        signal: this.signal(),
      });
      if (!response.ok) {
        throw new Error(`Remote endpoint returned ${response.status}`);
      }
    } catch (error) {
      // Re-queue the failed batch so it is retried on the next flush (no silent loss).
      this.batch = [...statsToSend, ...this.batch];
      throw new StorageError('Failed to send usage stats to remote endpoint', {
        endpoint: this.apiUrl,
        batchSize: statsToSend.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async close(): Promise<void> {
    stopPeriodicTask(this.timer);
    this.timer = undefined;

    await this.flush();
  }
}
