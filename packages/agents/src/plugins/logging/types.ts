/**
 * Logging strategy types
 */
export type LoggingStrategy = 'console' | 'file' | 'remote' | 'silent';

/**
 * Log levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log entry structure
 */
export interface LogEntry {
    timestamp: Date;
    level: LogLevel;
    message: string;
    context?: Record<string, string | number | boolean | Date>;
    metadata?: {
        executionId?: string;
        conversationId?: string;
        userId?: string;
        sessionId?: string;
        operation?: string;
        duration?: number;
    };
}

import type { BasePluginOptions } from '../../abstracts/base-plugin';
import type { SimpleLogger } from '../../utils/simple-logger';

/**
 * Configuration options for logging plugin
 */
export interface LoggingPluginOptions extends BasePluginOptions {
    /** Logging strategy to use */
    strategy: LoggingStrategy;
    /** Minimum log level to capture */
    level?: LogLevel;
    /** File path for file strategy */
    filePath?: string;
    /** Remote endpoint for remote strategy */
    remoteEndpoint?: string;
    /** Headers for remote logging */
    remoteHeaders?: Record<string, string>;
    /** Maximum number of logs to keep in memory */
    maxLogs?: number;
    /** Whether to include stack traces in error logs */
    includeStackTrace?: boolean;
    /** Custom log formatter */
    formatter?: LogFormatter;
    /** Logger instance for internal plugin logging */
    logger?: SimpleLogger;
    /** Batch size for remote logging */
    batchSize?: number;
    /** Flush interval for batched logging in milliseconds */
    flushInterval?: number;
}

/**
 * Log formatter interface
 */
export interface LogFormatter {
    format(entry: LogEntry): string;
}

/**
 * Log storage interface
 */
export interface LogStorage {
    write(entry: LogEntry): Promise<void>;
    flush(): Promise<void>;
    close(): Promise<void>;
}

/**
 * Logging plugin statistics
 */
export interface LoggingPluginStats {
    /** Total number of logs written */
    logsWritten: number;
    /** Number of failed log writes */
    failedWrites: number;
    /** Current log level */
    currentLevel: LogLevel;
    /** Storage strategy in use */
    strategy: LoggingStrategy;
    /** Last flush timestamp */
    lastFlushTime?: Date;
} 