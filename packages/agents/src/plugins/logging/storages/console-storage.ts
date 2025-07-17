import { LogEntry, LogStorage, LogFormatter } from '../types';
import { ConsoleLogFormatter } from '../formatters';
import { SimpleLogger, DefaultConsoleLogger } from '../../../utils/simple-logger';

/**
 * Console log storage
 */
export class ConsoleLogStorage implements LogStorage {
    private formatter: LogFormatter;
    private logger: SimpleLogger;

    constructor(formatter?: LogFormatter, logger?: SimpleLogger) {
        this.formatter = formatter || new ConsoleLogFormatter();
        this.logger = logger || DefaultConsoleLogger;
    }

    async write(entry: LogEntry): Promise<void> {
        const formatted = this.formatter.format(entry);

        switch (entry.level) {
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