import type { ILogEntry, ILogFormatter } from './types';

const LEVEL_PAD_WIDTH = 5;

/**
 * Default console formatter
 */
export class ConsoleLogFormatter implements ILogFormatter {
    format(entry: ILogEntry): string {
        const timestamp = entry.timestamp.toISOString();
        const level = entry.level.toUpperCase().padStart(LEVEL_PAD_WIDTH);
        const contextStr = entry.context ? ` | ${JSON.stringify(entry.context)}` : '';
        const metadataStr = entry.metadata ? ` | ${JSON.stringify(entry.metadata)}` : '';
        return `[${timestamp}] ${level} | ${entry.message}${contextStr}${metadataStr}`;
    }
}

/**
 * JSON formatter for file/remote logging
 */
export class JsonLogFormatter implements ILogFormatter {
    format(entry: ILogEntry): string {
        return JSON.stringify({
            ...entry,
            timestamp: entry.timestamp.toISOString()
        });
    }
} 