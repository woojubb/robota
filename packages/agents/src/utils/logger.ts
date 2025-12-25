import type { TLoggerData } from '../interfaces/types';
import { SimpleLogger, DefaultConsoleLogger } from './simple-logger';

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
    debug(message: string, context?: TLoggerData): void;
    info(message: string, context?: TLoggerData): void;
    warn(message: string, context?: TLoggerData): void;
    error(message: string, context?: TLoggerData): void;
    isDebugEnabled(): boolean;
    setLevel(level: TUtilLogLevel): void;
    getLevel(): TUtilLogLevel;
}

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
    private simpleLogger: SimpleLogger;

    constructor(packageName: string, logger?: SimpleLogger) {
        this.packageName = packageName;
        this.simpleLogger = logger || DefaultConsoleLogger;
    }

    debug(message: string, context?: TLoggerData): void {
        if (this.shouldLog('debug')) {
            this.log('debug', message, context);
        }
    }

    info(message: string, context?: TLoggerData): void {
        if (this.shouldLog('info')) {
            this.log('info', message, context);
        }
    }

    warn(message: string, context?: TLoggerData): void {
        if (this.shouldLog('warn')) {
            this.log('warn', message, context);
        }
    }

    error(message: string, context?: TLoggerData): void {
        if (this.shouldLog('error')) {
            this.log('error', message, context);
        }
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

    private log(level: TUtilLogLevel, message: string, context?: TLoggerData): void {
        const entry: IUtilLogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            ...(context && { context }),
            packageName: this.packageName
        };

        const formattedMessage = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.packageName}] ${entry.message}`;

        if (context && Object.keys(context).length > 0) {
            const contextStr = JSON.stringify(context, null, 2);
            this.simpleLogger.log(formattedMessage, '\n', contextStr);
        } else {
            this.simpleLogger.log(formattedMessage);
        }
    }
}

/**
 * Create a logger instance for a package
 * @internal
 */
export function createLogger(packageName: string, logger?: SimpleLogger): ILogger {
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