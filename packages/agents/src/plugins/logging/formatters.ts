import { LogEntry, LogFormatter } from './types.js';

/**
 * Default console formatter
 */
export class ConsoleLogFormatter implements LogFormatter {
    format(entry: LogEntry): string {
        const timestamp = entry.timestamp.toISOString();
        const level = entry.level.toUpperCase().padStart(5);
        const contextStr = entry.context ? ` | ${JSON.stringify(entry.context)}` : '';
        const metadataStr = entry.metadata ? ` | ${JSON.stringify(entry.metadata)}` : '';
        return `[${timestamp}] ${level} | ${entry.message}${contextStr}${metadataStr}`;
    }
}

/**
 * JSON formatter for file/remote logging
 */
export class JsonLogFormatter implements LogFormatter {
    format(entry: LogEntry): string {
        return JSON.stringify({
            ...entry,
            timestamp: entry.timestamp.toISOString()
        });
    }
} 