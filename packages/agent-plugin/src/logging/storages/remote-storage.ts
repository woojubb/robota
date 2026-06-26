import {
  createLogger,
  type ILogger,
  PluginError,
  type TTimerId,
  startPeriodicTask,
  stopPeriodicTask,
} from '@robota-sdk/agent-core';

import { JsonLogFormatter } from '../formatters';

import type { ILogEntry, ILogStorage, ILogFormatter } from '../types';

/**
 * Remote log storage with batching
 */
export class RemoteLogStorage implements ILogStorage {
  private url: string;
  private formatter: ILogFormatter;
  private batchSize: number;
  private flushInterval: number;
  private timeout: number;
  private pendingLogs: ILogEntry[] = [];
  private flushTimer: TTimerId | undefined;
  private logger: ILogger;

  constructor(url: string, options: { timeout?: number } = {}) {
    this.url = url;
    this.formatter = new JsonLogFormatter();
    this.batchSize = 10;
    this.flushInterval = 5000;
    this.timeout = options.timeout ?? 0;
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
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ logs: logsToSend.map((log) => this.formatter.format(log)) }),
        signal: this.timeout > 0 ? AbortSignal.timeout(this.timeout) : undefined,
      });
      if (!response.ok) {
        throw new Error(`Remote endpoint returned ${response.status}`);
      }
    } catch (error) {
      // Re-queue the failed batch so it is retried on the next flush (no silent loss).
      this.pendingLogs = [...logsToSend, ...this.pendingLogs];
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
