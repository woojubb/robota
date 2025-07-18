import type { LoggerData } from '../interfaces/types';
import { SimpleLogger, DefaultConsoleLogger } from './simple-logger';

/**
 * Reusable type definitions for logger utility
 */

/**
 * Logger context data type - uses centralized type definition
 */
export type LoggerContextData = LoggerData;

/**
 * Log levels for the logger
 */
export type UtilLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Log entry structure
 */
export interface UtilLogEntry {
    timestamp: string;
    level: UtilLogLevel;
    message: string;
    context?: LoggerContextData;
    packageName?: string;
}

/**
 * Logger interface
 */
export interface Logger {
    debug(message: string, context?: LoggerContextData): void;
    info(message: string, context?: LoggerContextData): void;
    warn(message: string, context?: LoggerContextData): void;
    error(message: string, context?: LoggerContextData): void;
    isDebugEnabled(): boolean;
    setLevel(level: UtilLogLevel): void;
    getLevel(): UtilLogLevel;
}

/**
 * Global logger configuration
 */
class LoggerConfig {
    private static instance: LoggerConfig;
    private globalLevel: UtilLogLevel;

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

    getGlobalLevel(): UtilLogLevel {
        return this.globalLevel;
    }

    setGlobalLevel(level: UtilLogLevel): void {
        this.globalLevel = level;
    }
}

/**
 * Console logger implementation
 * @internal
 */
export class ConsoleLogger implements Logger {
    private level: UtilLogLevel | null = null; // null means use global level
    private packageName: string;
    private simpleLogger: SimpleLogger;

    constructor(packageName: string, logger?: SimpleLogger) {
        this.packageName = packageName;
        this.simpleLogger = logger || DefaultConsoleLogger;
    }

    debug(message: string, context?: LoggerContextData): void {
        if (this.shouldLog('debug')) {
            this.log('debug', message, context);
        }
    }

    info(message: string, context?: LoggerContextData): void {
        if (this.shouldLog('info')) {
            this.log('info', message, context);
        }
    }

    warn(message: string, context?: LoggerContextData): void {
        if (this.shouldLog('warn')) {
            this.log('warn', message, context);
        }
    }

    error(message: string, context?: LoggerContextData): void {
        if (this.shouldLog('error')) {
            this.log('error', message, context);
        }
    }

    isDebugEnabled(): boolean {
        return this.shouldLog('debug');
    }

    setLevel(level: UtilLogLevel): void {
        this.level = level;
    }

    getLevel(): UtilLogLevel {
        return this.level || LoggerConfig.getInstance().getGlobalLevel();
    }

    private shouldLog(level: UtilLogLevel): boolean {
        const currentLevel = this.getLevel();
        if (currentLevel === 'silent') return false;

        const levels: UtilLogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];
        return levels.indexOf(level) >= levels.indexOf(currentLevel);
    }

    private log(level: UtilLogLevel, message: string, context?: LoggerContextData): void {
        const entry: UtilLogEntry = {
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
export function createLogger(packageName: string, logger?: SimpleLogger): Logger {
    return new ConsoleLogger(packageName, logger);
}

/**
 * Set global log level for all loggers
 */
export function setGlobalLogLevel(level: UtilLogLevel): void {
    LoggerConfig.getInstance().setGlobalLevel(level);
}

/**
 * Get global log level
 */
export function getGlobalLogLevel(): UtilLogLevel {
    return LoggerConfig.getInstance().getGlobalLevel();
}

/**
 * Default logger for the agents package
 */
export const logger = createLogger('agents'); 