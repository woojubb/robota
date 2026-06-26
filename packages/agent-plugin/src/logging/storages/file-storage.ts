import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { createLogger, type ILogger, PluginError } from '@robota-sdk/agent-core';

import { JsonLogFormatter } from '../formatters';

import type { ILogEntry, ILogStorage, ILogFormatter } from '../types';

/**
 * File-backed log storage.
 *
 * Each entry is formatted and appended as a single line. Appends are
 * write-through, so `flush`/`close` have no buffered state to drain.
 */
export class FileLogStorage implements ILogStorage {
  private filePath: string;
  private formatter: ILogFormatter;
  private logger: ILogger;

  constructor(filePath: string, formatter?: ILogFormatter) {
    this.filePath = filePath;
    this.formatter = formatter || new JsonLogFormatter();
    this.logger = createLogger('FileLogStorage');
  }

  async write(entry: ILogEntry): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${this.formatter.format(entry)}\n`, 'utf8');
    } catch (error) {
      throw new PluginError('Failed to write log to file', 'LoggingPlugin', {
        filePath: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async flush(): Promise<void> {
    // Each write is appended immediately; nothing is buffered.
    this.logger.debug('FileLogStorage.flush is a no-op (write-through)', {
      filePath: this.filePath,
    });
  }

  async close(): Promise<void> {
    // No long-lived file handle is held between writes.
    this.logger.debug('FileLogStorage.close is a no-op (no open handle)', {
      filePath: this.filePath,
    });
  }
}
