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
    context?: Record<string, any>;
    packageName?: string;
}

/**
 * Logger interface
 */
export interface Logger {
    debug(message: string, context?: Record<string, any>): void;
    info(message: string, context?: Record<string, any>): void;
    warn(message: string, context?: Record<string, any>): void;
    error(message: string, context?: Record<string, any>): void;
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
        // Check environment variables and set default level
        const envLevel = process.env.ROBOTA_LOG_LEVEL?.toLowerCase() as UtilLogLevel;
        this.globalLevel = envLevel && this.isValidLevel(envLevel) ? envLevel : 'warn';
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

    private isValidLevel(level: string): level is UtilLogLevel {
        return ['debug', 'info', 'warn', 'error', 'silent'].includes(level);
    }
}

/**
 * Console logger implementation
 */
export class Logger implements Logger {
    private level: UtilLogLevel | null = null; // null means use global level
    private packageName: string;

    constructor(packageName: string) {
        this.packageName = packageName;
    }

    debug(message: string, context?: Record<string, any>): void {
        if (this.shouldLog('debug')) {
            this.log('debug', message, context);
        }
    }

    info(message: string, context?: Record<string, any>): void {
        if (this.shouldLog('info')) {
            this.log('info', message, context);
        }
    }

    warn(message: string, context?: Record<string, any>): void {
        if (this.shouldLog('warn')) {
            this.log('warn', message, context);
        }
    }

    error(message: string, context?: Record<string, any>): void {
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

    private log(level: UtilLogLevel, message: string, context?: Record<string, any>): void {
        const entry: UtilLogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            context,
            packageName: this.packageName
        };

        const formattedMessage = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.packageName}] ${entry.message}`;

        if (context && Object.keys(context).length > 0) {
            const contextStr = JSON.stringify(context, null, 2);
            console.log(formattedMessage, '\n', contextStr);
        } else {
            console.log(formattedMessage);
        }
    }
}

/**
 * Create a logger instance for a package
 */
export function createLogger(packageName: string): Logger {
    return new Logger(packageName);
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