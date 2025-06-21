/**
 * Log levels for the logger
 */
export type UtilLogLevel = 'debug' | 'info' | 'warn' | 'error';

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
}

/**
 * Console logger implementation
 */
export class Logger implements Logger {
    private level: UtilLogLevel = 'info';
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

    private shouldLog(level: UtilLogLevel): boolean {
        const levels: UtilLogLevel[] = ['debug', 'info', 'warn', 'error'];
        return levels.indexOf(level) >= levels.indexOf(this.level);
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
 * Default logger for the agents package
 */
export const logger = createLogger('agents'); 