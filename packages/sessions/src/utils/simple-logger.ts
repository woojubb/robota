/**
 * Logger interface for session-related logging
 * 
 * Provides standardized logging methods with different severity levels.
 * Implementations can route logs to console, files, or external services.
 * 
 * @public
 */
export interface Logger {
    /**
     * Log debug information
     * 
     * @param message - Debug message
     * @param args - Additional arguments to log
     */
    debug(message: string, ...args: any[]): void;

    /**
     * Log informational messages
     * 
     * @param message - Info message
     * @param args - Additional arguments to log
     */
    info(message: string, ...args: any[]): void;

    /**
     * Log warning messages
     * 
     * @param message - Warning message
     * @param args - Additional arguments to log
     */
    warn(message: string, ...args: any[]): void;

    /**
     * Log error messages
     * 
     * @param message - Error message
     * @param args - Additional arguments to log
     */
    error(message: string, ...args: any[]): void;
}

/**
 * Simple console-based logger implementation
 * 
 * Routes all log messages to the browser/Node.js console with
 * structured prefixes for easy identification and filtering.
 * 
 * @public
 */
export class SimpleLoggerImpl implements Logger {
    /** @internal Prefix for log messages */
    private prefix: string;

    /**
     * Create a new simple logger instance
     * 
     * @param prefix - Prefix to prepend to all log messages
     */
    constructor(prefix: string = 'SessionSDK') {
        this.prefix = prefix;
    }

    /**
 * Log debug information to console
 * 
 * @param message - Debug message
 * @param args - Additional arguments to log
 */
    debug(message: string, ...args: any[]): void {
        // eslint-disable-next-line no-console
        console.debug(`[${this.prefix}:DEBUG] ${message}`, ...args);
    }

    /**
     * Log informational messages to console
     * 
     * @param message - Info message
     * @param args - Additional arguments to log
     */
    info(message: string, ...args: any[]): void {
        // eslint-disable-next-line no-console
        console.info(`[${this.prefix}:INFO] ${message}`, ...args);
    }

    /**
     * Log warning messages to console
     * 
     * @param message - Warning message
     * @param args - Additional arguments to log
     */
    warn(message: string, ...args: any[]): void {
        // eslint-disable-next-line no-console
        console.warn(`[${this.prefix}:WARN] ${message}`, ...args);
    }

    /**
     * Log error messages to console
     * 
     * @param message - Error message
     * @param args - Additional arguments to log
     */
    error(message: string, ...args: any[]): void {
        // eslint-disable-next-line no-console
        console.error(`[${this.prefix}:ERROR] ${message}`, ...args);
    }
} 