/**
 * Logging strategy types
 */
export type TLoggingStrategy = 'console' | 'file' | 'remote' | 'silent';

/**
 * Log levels
 */
export type TLogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log entry structure
 */
export interface ILogEntry {
    timestamp: Date;
    level: TLogLevel;
    message: string;
    context?: Record<string, string | number | boolean | Date | undefined>;
    metadata?: {
        executionId?: string;
        conversationId?: string;
        userId?: string;
        sessionId?: string;
        operation?: string;
        duration?: number;
    };
}

import type { IPluginOptions, IPluginStats } from '../../abstracts/abstract-plugin';
import type { SimpleLogger } from '../../utils/simple-logger';

/**
 * Configuration options for logging plugin
 */
export interface ILoggingPluginOptions extends IPluginOptions {
    /** Logging strategy to use */
    strategy: TLoggingStrategy;
    /** Minimum log level to capture */
    level?: TLogLevel;
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
    formatter?: ILogFormatter;
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
export interface ILogFormatter {
    format(entry: ILogEntry): string;
}

/**
 * Log storage interface
 */
export interface ILogStorage {
    write(entry: ILogEntry): Promise<void>;
    flush(): Promise<void>;
    close(): Promise<void>;
}

/**
 * Logging plugin statistics
 */
export interface ILoggingPluginStats extends IPluginStats {
    /** Total number of logs written */
    logsWritten: number;
    /** Number of failed log writes */
    failedWrites: number;
    /** Current log level */
    currentLevel: TLogLevel;
    /** Storage strategy in use */
    strategy: TLoggingStrategy;
    /** Last flush timestamp */
    lastFlushTime?: Date;
} 