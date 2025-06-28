import { UsageStorage, UsageStats, AggregatedUsageStats } from '../types';
import { Logger, createLogger } from '../../../utils/logger';
import { StorageError } from '../../../utils/errors';

/**
 * Remote storage implementation for usage statistics with batching
 */
export class RemoteUsageStorage implements UsageStorage {
    private apiUrl: string;
    private batchSize: number;
    private flushInterval: number;
    private batch: UsageStats[] = [];
    private timer: NodeJS.Timeout | null = null;
    private logger: Logger;

    constructor(
        apiUrl: string,
        _apiKey: string,
        _timeout: number,
        _headers: Record<string, string> = {},
        batchSize: number = 50,
        flushInterval: number = 60000 // 1 minute
    ) {
        this.apiUrl = apiUrl;
        this.batchSize = batchSize;
        this.flushInterval = flushInterval;
        this.logger = createLogger('RemoteUsageStorage');

        this.startTimer();
    }

    async save(entry: UsageStats): Promise<void> {
        this.batch.push(entry);

        if (this.batch.length >= this.batchSize) {
            await this.flush();
        }
    }

    async getStats(conversationId?: string, timeRange?: { start: Date; end: Date }): Promise<UsageStats[]> {
        try {
            // Remote API call would be implemented here
            this.logger.warn('Remote usage storage not fully implemented yet', {
                endpoint: this.apiUrl,
                operation: 'getStats',
                conversationId,
                timeRange
            });
            return [];
        } catch (error) {
            throw new StorageError('Failed to get usage stats from remote endpoint', {
                endpoint: this.apiUrl,
                conversationId: conversationId || 'all',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    async getAggregatedStats(timeRange?: { start: Date; end: Date }): Promise<AggregatedUsageStats> {
        try {
            // Remote API call would be implemented here
            this.logger.warn('Remote usage storage not fully implemented yet', {
                endpoint: this.apiUrl,
                operation: 'getAggregatedStats',
                timeRange
            });

            // Return empty aggregated stats as placeholder
            return {
                totalRequests: 0,
                totalTokens: 0,
                totalCost: 0,
                totalDuration: 0,
                successRate: 0,
                providerStats: {},
                modelStats: {},
                toolStats: {},
                timeRangeStats: {
                    startTime: timeRange?.start || new Date(),
                    endTime: timeRange?.end || new Date(),
                    period: 'unknown'
                }
            };
        } catch (error) {
            throw new StorageError('Failed to get aggregated usage stats from remote endpoint', {
                endpoint: this.apiUrl,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    async clear(): Promise<void> {
        try {
            // Remote API call would be implemented here
            this.logger.warn('Remote usage storage not fully implemented yet', {
                endpoint: this.apiUrl,
                operation: 'clear'
            });
        } catch (error) {
            throw new StorageError('Failed to clear usage stats from remote endpoint', {
                endpoint: this.apiUrl,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    async flush(): Promise<void> {
        if (this.batch.length === 0) return;

        const statsToSend = [...this.batch];
        this.batch = [];

        try {
            // Remote API call would be implemented here
            // This is a placeholder for actual HTTP requests
            this.logger.warn('Remote usage storage not fully implemented yet', {
                endpoint: this.apiUrl,
                operation: 'flush',
                batchSize: statsToSend.length,
                sample: statsToSend.slice(0, 3).map(stat => ({
                    timestamp: stat.timestamp.toISOString(),
                    provider: stat.provider,
                    model: stat.model,
                    tokens: stat.tokensUsed.total,
                    cost: stat.cost?.total,
                    success: stat.success
                }))
            });
        } catch (error) {
            // Re-add failed batch to the beginning of current batch
            this.batch = [...statsToSend, ...this.batch];
            throw new StorageError('Failed to send usage stats to remote endpoint', {
                endpoint: this.apiUrl,
                batchSize: statsToSend.length,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    async close(): Promise<void> {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        await this.flush();
    }

    private startTimer(): void {
        this.timer = setInterval(async () => {
            try {
                await this.flush();
            } catch (error) {
                this.logger.error('Failed to flush usage stats on timer', {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, this.flushInterval);
    }
} 