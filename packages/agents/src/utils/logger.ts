import type { TLoggerData, TUniversalValue } from '../interfaces/types';

/**
 * Reusable type definitions for logger utility
 */


/**
 * Log levels for the logger
 */
export type TUtilLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Log entry structure
 */
export interface IUtilLogEntry {
    timestamp: string;
    level: TUtilLogLevel;
    message: string;
    context?: TLoggerData;
    packageName?: string;
}

/**
 * Logger interface
 */
export interface ILogger {
    debug(...args: Array<TUniversalValue | TLoggerData | Error>): void;
    info(...args: Array<TUniversalValue | TLoggerData | Error>): void;
    warn(...args: Array<TUniversalValue | TLoggerData | Error>): void;
    error(...args: Array<TUniversalValue | TLoggerData | Error>): void;
    log(...args: Array<TUniversalValue | TLoggerData | Error>): void;
    group?(label?: string): void;
    groupEnd?(): void;
    isDebugEnabled(): boolean;
    setLevel(level: TUtilLogLevel): void;
    getLevel(): TUtilLogLevel;
}

/**
 * Silent logger that does nothing (Null Object Pattern)
 *
 * IMPORTANT:
 * - This library must not write to stdio by default.
 * - Inject a real logger explicitly if you want output.
 */
export const SilentLogger: ILogger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
    log: () => { },
    group: () => { },
    groupEnd: () => { },
    isDebugEnabled: () => false,
    // SilentLogger is intentionally immutable/no-op; level setters are ignored.
    setLevel: () => { },
    getLevel: () => 'silent',
};

/**
 * Global logger configuration
 */
class LoggerConfig {
    private static instance: LoggerConfig;
    private globalLevel: TUtilLogLevel;

    private constructor() {
        // Set default level (environment variables no longer used for browser compatibility)
        this.globalLevel = 'warn';
    }

    static getInstance(): LoggerConfig {
        if (!LoggerConfig.instance) {
            LoggerConfig.instance = new LoggerConfig();
        }
        return LoggerConfig.instance;
    }

    getGlobalLevel(): TUtilLogLevel {
        return this.globalLevel;
    }

    setGlobalLevel(level: TUtilLogLevel): void {
        this.globalLevel = level;
    }
}

/**
 * Console logger implementation
 * @internal
 */
export class ConsoleLogger implements ILogger {
    private level: TUtilLogLevel | null = null; // null means use global level
    private packageName: string;
    private sinkLogger: ILogger;

    constructor(packageName: string, logger?: ILogger) {
        this.packageName = packageName;
        this.sinkLogger = logger || SilentLogger;
    }

    debug(...args: Array<TUniversalValue | TLoggerData | Error>): void {
        if (this.shouldLog('debug')) {
            const [message, context] = args;
            this.writeEntry('debug', String(message ?? ''), isLoggerContext(context) ? context : undefined);
        }
    }

    info(...args: Array<TUniversalValue | TLoggerData | Error>): void {
        if (this.shouldLog('info')) {
            const [message, context] = args;
            this.writeEntry('info', String(message ?? ''), isLoggerContext(context) ? context : undefined);
        }
    }

    warn(...args: Array<TUniversalValue | TLoggerData | Error>): void {
        if (this.shouldLog('warn')) {
            const [message, context] = args;
            this.writeEntry('warn', String(message ?? ''), isLoggerContext(context) ? context : undefined);
        }
    }

    error(...args: Array<TUniversalValue | TLoggerData | Error>): void {
        if (this.shouldLog('error')) {
            const [message, context] = args;
            this.writeEntry('error', String(message ?? ''), isLoggerContext(context) ? context : undefined);
        }
    }

    log(...args: Array<TUniversalValue | TLoggerData | Error>): void {
        // Alias for info-level output (when enabled).
        this.info(...args);
    }

    isDebugEnabled(): boolean {
        return this.shouldLog('debug');
    }

    setLevel(level: TUtilLogLevel): void {
        this.level = level;
    }

    getLevel(): TUtilLogLevel {
        return this.level || LoggerConfig.getInstance().getGlobalLevel();
    }

    private shouldLog(level: TUtilLogLevel): boolean {
        const currentLevel = this.getLevel();
        if (currentLevel === 'silent') return false;

        const levels: TUtilLogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];
        return levels.indexOf(level) >= levels.indexOf(currentLevel);
    }

    private writeEntry(level: TUtilLogLevel, message: string, context?: TLoggerData): void {
        const entry: IUtilLogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            ...(context && { context }),
            packageName: this.packageName
        };

        const formattedMessage = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.packageName}] ${entry.message}`;
        switch (level) {
            case 'debug':
                this.sinkLogger.debug(formattedMessage, context ?? {});
                return;
            case 'info':
                this.sinkLogger.info(formattedMessage, context ?? {});
                return;
            case 'warn':
                this.sinkLogger.warn(formattedMessage, context ?? {});
                return;
            case 'error':
                this.sinkLogger.error(formattedMessage, context ?? {});
                return;
            case 'silent':
                return;
        }
    }
}

function isLoggerContext(value: unknown): value is TLoggerData {
    return typeof value === 'object' && value !== null && !(value instanceof Error) && !(value instanceof Date) && !Array.isArray(value);
}

/**
 * Create a logger instance for a package
 * @internal
 */
export function createLogger(packageName: string, logger?: ILogger): ILogger {
    return new ConsoleLogger(packageName, logger);
}

/**
 * Set global log level for all loggers
 */
export function setGlobalLogLevel(level: TUtilLogLevel): void {
    LoggerConfig.getInstance().setGlobalLevel(level);
}

/**
 * Get global log level
 */
export function getGlobalLogLevel(): TUtilLogLevel {
    return LoggerConfig.getInstance().getGlobalLevel();
}

/**
 * Default logger for the agents package
 */
export const logger = createLogger('agents'); 