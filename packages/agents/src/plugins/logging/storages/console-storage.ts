import { LogEntry, LogStorage, LogFormatter } from '../types';
import { ConsoleLogFormatter } from '../formatters';

/**
 * Console log storage
 */
export class ConsoleLogStorage implements LogStorage {
    private formatter: LogFormatter;

    constructor(formatter?: LogFormatter) {
        this.formatter = formatter || new ConsoleLogFormatter();
    }

    async write(entry: LogEntry): Promise<void> {
        const formatted = this.formatter.format(entry);

        switch (entry.level) {
            case 'debug':
                console.debug(formatted);
                break;
            case 'info':
                console.info(formatted);
                break;
            case 'warn':
                console.warn(formatted);
                break;
            case 'error':
                console.error(formatted);
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