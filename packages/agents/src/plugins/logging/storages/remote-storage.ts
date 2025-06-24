import { LogEntry, LogStorage, LogFormatter } from '../types';
import { JsonLogFormatter } from '../formatters';
import { Logger } from '../../../utils/logger';
import { PluginError } from '../../../utils/errors';

/**
 * Remote log storage with batching
 */
export class RemoteLogStorage implements LogStorage {
    private endpoint: string;
    private headers: Record<string, string>;
    private formatter: LogFormatter;
    private batchSize: number;
    private flushInterval: number;
    private batch: LogEntry[] = [];
    private timer: NodeJS.Timeout | null = null;
    private logger: Logger;

    constructor(
        endpoint: string,
        headers: Record<string, string> = {},
        formatter?: LogFormatter,
        batchSize: number = 10,
        flushInterval: number = 5000
    ) {
        this.endpoint = endpoint;
        this.headers = headers;
        this.formatter = formatter || new JsonLogFormatter();
        this.batchSize = batchSize;
        this.flushInterval = flushInterval;
        this.logger = new Logger('RemoteLogStorage');

        this.startTimer();
    }

    async write(entry: LogEntry): Promise<void> {
        this.batch.push(entry);

        if (this.batch.length >= this.batchSize) {
            await this.flush();
        }
    }

    async flush(): Promise<void> {
        if (this.batch.length === 0) return;

        const logsToSend = [...this.batch];
        this.batch = [];

        try {
            // Remote sending would be implemented here
            // This is a placeholder for actual HTTP requests
            this.logger.warn('Remote logging not fully implemented yet', {
                endpoint: this.endpoint,
                logCount: logsToSend.length,
                logs: logsToSend.map(log => this.formatter.format(log))
            });
        } catch (error) {
            throw new PluginError('Failed to send logs to remote endpoint', 'LoggingPlugin', {
                endpoint: this.endpoint,
                logCount: logsToSend.length,
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
                this.logger.error('Failed to flush logs on timer', {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, this.flushInterval);
    }
} 