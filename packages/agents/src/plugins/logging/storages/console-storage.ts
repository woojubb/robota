import type { ILogEntry, ILogStorage, ILogFormatter, TLogLevel } from '../types';
import { ConsoleLogFormatter } from '../formatters';
import { SimpleLogger, DefaultConsoleLogger } from '../../../utils/simple-logger';

/**
 * Console log storage
 */
export class ConsoleLogStorage implements ILogStorage {
    private formatter: ILogFormatter;
    private logger: SimpleLogger;

    constructor(formatter?: ILogFormatter, logger?: SimpleLogger) {
        this.formatter = formatter || new ConsoleLogFormatter();
        this.logger = logger || DefaultConsoleLogger;
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