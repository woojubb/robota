import type { ILogEntry, ILogStorage, ILogFormatter, TLogLevel } from '../types';
import { ConsoleLogFormatter } from '../formatters';
import { SilentLogger, type ILogger } from '@robota-sdk/agents';

/**
 * Console log storage
 */
export class ConsoleLogStorage implements ILogStorage {
  private formatter: ILogFormatter;
  private logger: ILogger;

  constructor(formatter?: ILogFormatter, logger?: ILogger) {
    this.formatter = formatter || new ConsoleLogFormatter();
    this.logger = logger || SilentLogger;
  }

  async write(entry: ILogEntry): Promise<void> {
    const formatted = this.formatter.format(entry);

    const level: TLogLevel = entry.level;
    switch (level) {
      case 'debug':
        this.logger.debug(formatted);
        break;
      case 'info':
        this.logger.info(formatted);
        break;
      case 'warn':
        this.logger.warn(formatted);
        break;
      case 'error':
        this.logger.error(formatted);
        break;
    }
  }

  async flush(): Promise<void> {
    // Console doesn't need flushing
  }

  async close(): Promise<void> {
    // Console doesn't need closing
  }
}
