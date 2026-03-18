import type { ILogEntry, ILogStorage, ILogFormatter } from '../types';
import { JsonLogFormatter } from '../formatters';
import {
  createLogger,
  type ILogger,
  PluginError,
  type TTimerId,
  startPeriodicTask,
  stopPeriodicTask,
} from '@robota-sdk/agents';

/**
 * Remote log storage with batching
 */
export class RemoteLogStorage implements ILogStorage {
  private url: string;
  private formatter: ILogFormatter;
  private batchSize: number;
  private flushInterval: number;
  private pendingLogs: ILogEntry[] = [];
  private flushTimer: TTimerId | undefined;
  private logger: ILogger;

  constructor(url: string, _options: { timeout?: number } = {}) {
    this.url = url;
    this.formatter = new JsonLogFormatter();
    this.batchSize = 10;
    this.flushInterval = 5000;
    this.logger = createLogger('RemoteLogStorage');

    // Start flush timer
    this.flushTimer = startPeriodicTask(
      this.logger,
      { name: 'RemoteLogStorage.flush', intervalMs: this.flushInterval },
      async () => {
        await this.flush();
      },
    );
  }

  async write(entry: ILogEntry): Promise<void> {
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
        logs: logsToSend.map((log) => this.formatter.format(log)),
      });
    } catch (error) {
      throw new PluginError('Failed to send logs to remote endpoint', 'LoggingPlugin', {
        url: this.url,
        logCount: logsToSend.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async close(): Promise<void> {
    stopPeriodicTask(this.flushTimer);
    this.flushTimer = undefined;

    await this.flush();
  }
}
