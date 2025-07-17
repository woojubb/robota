import { LogEntry, LogStorage, LogFormatter } from '../types';
import { JsonLogFormatter } from '../formatters';
import { Logger, createLogger } from '../../../utils/logger';
import { PluginError } from '../../../utils/errors';
import type { TimerId } from '../../../utils';

/**
 * Remote log storage with batching
 */
export class RemoteLogStorage implements LogStorage {
    private url: string;
    private formatter: LogFormatter;
    private batchSize: number;
    private flushInterval: number;
    private pendingLogs: LogEntry[] = [];
    private flushTimer: TimerId | undefined;
    private logger: Logger;

    constructor(url: string, _options: { timeout?: number } = {}) {
        this.url = url;
        this.formatter = new JsonLogFormatter();
        this.batchSize = 10;
        this.flushInterval = 5000;
        this.logger = createLogger('RemoteLogStorage');

        // Start flush timer
        this.startFlushTimer();
    }

    async write(entry: LogEntry): Promise<void> {
        this.pendingLogs.push(entry);

        if (this.pendingLogs.length >= this.batchSize) {
            await this.flush();
        }
    }

    async flush(): Promise<void> {
        if (this.pendingLogs.length === 0) return;

        const logsToSend = [...this.pendingLogs];
        this.pendingLogs = [];

        try {
            // Remote sending would be implemented here
            // This is a placeholder for actual HTTP requests
            this.logger.warn('Remote logging not fully implemented yet', {
                url: this.url,
                logCount: logsToSend.length,
                logs: logsToSend.map(log => this.formatter.format(log))
            });
        } catch (error) {
            throw new PluginError('Failed to send logs to remote endpoint', 'LoggingPlugin', {
                url: this.url,
                logCount: logsToSend.length,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    async close(): Promise<void> {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = undefined;
        }

        await this.flush();
    }

    private startFlushTimer(): void {
        this.flushTimer = setInterval(async () => {
            try {
                await this.flush();
            } catch (error) {
                this.logger.error('Failed to flush logs on timer', {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, this.flushInterval);
    }
} 