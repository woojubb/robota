import { BasePlugin } from '../../abstracts/base-plugin';
import { Logger, createLogger } from '../../utils/logger';
import { PluginError, ConfigurationError } from '../../utils/errors';
import {
    LogLevel,
    LogEntry,
    LoggingPluginOptions,
    LogStorage,
    LogFormatter
} from './types';
import {
    ConsoleLogStorage,
    FileLogStorage,
    RemoteLogStorage,
    SilentLogStorage
} from './storages/index';

/**
 * Plugin for logging agent operations
 * Supports multiple logging strategies: console, file, remote, silent
 */
export class LoggingPlugin extends BasePlugin {
    name = 'LoggingPlugin';
    version = '1.0.0';

    private storage: LogStorage;
    private options: Required<Omit<LoggingPluginOptions, 'formatter'>> & { formatter?: LogFormatter };
    private logger: Logger;
    private logLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];

    constructor(options: LoggingPluginOptions) {
        super();
        this.logger = createLogger('LoggingPlugin');

        // Validate options
        this.validateOptions(options);

        // Set defaults
        this.options = {
            strategy: options.strategy,
            level: options.level ?? 'info',
            filePath: options.filePath ?? './agent.log',
            remoteEndpoint: options.remoteEndpoint ?? '',
            remoteHeaders: options.remoteHeaders ?? {},
            maxLogs: options.maxLogs ?? 10000,
            includeStackTrace: options.includeStackTrace ?? true,
            ...(options.formatter && { formatter: options.formatter }),
            batchSize: options.batchSize ?? 100,
            flushInterval: options.flushInterval ?? 30000,
        };

        // Initialize storage
        this.storage = this.createStorage();

        this.logger.info('LoggingPlugin initialized', {
            strategy: this.options.strategy,
            level: this.options.level,
            maxLogs: this.options.maxLogs
        });
    }

    /**
     * Log a message
     */
    async log(level: LogLevel, message: string, context?: Record<string, any>, metadata?: LogEntry['metadata']): Promise<void> {
        if (!this.shouldLog(level)) {
            return;
        }

        try {
            const entry: LogEntry = {
                timestamp: new Date(),
                level,
                message,
                ...(context && { context }),
                ...(metadata && { metadata })
            };

            await this.storage.write(entry);
        } catch (error) {
            // Don't throw errors from logging to avoid infinite loops
            console.error('Logging failed:', error);
        }
    }

    /**
     * Log debug message
     */
    async debug(message: string, context?: Record<string, any>, metadata?: LogEntry['metadata']): Promise<void> {
        await this.log('debug', message, context, metadata);
    }

    /**
     * Log info message
     */
    async info(message: string, context?: Record<string, any>, metadata?: LogEntry['metadata']): Promise<void> {
        await this.log('info', message, context, metadata);
    }

    /**
     * Log warning message
     */
    async warn(message: string, context?: Record<string, any>, metadata?: LogEntry['metadata']): Promise<void> {
        await this.log('warn', message, context, metadata);
    }

    /**
     * Log error message
     */
    async error(message: string, error?: Error, context?: Record<string, any>, metadata?: LogEntry['metadata']): Promise<void> {
        const errorContext = {
            ...context,
            ...(error && this.options.includeStackTrace ? {
                errorMessage: error.message,
                errorStack: error.stack
            } : {})
        };

        await this.log('error', message, errorContext, metadata);
    }

    /**
     * Log execution start
     */
    async logExecutionStart(executionId: string, userInput: string, metadata?: Record<string, any>): Promise<void> {
        await this.info('Execution started', { userInput: userInput.substring(0, 100) }, {
            executionId,
            operation: 'execution_start',
            ...metadata
        });
    }

    /**
     * Log execution completion
     */
    async logExecutionComplete(executionId: string, duration: number, metadata?: Record<string, any>): Promise<void> {
        await this.info('Execution completed', { duration }, {
            executionId,
            operation: 'execution_complete',
            ...(duration !== undefined && { duration }),
            ...metadata
        });
    }

    /**
     * Log tool execution
     */
    async logToolExecution(toolName: string, executionId: string, duration?: number, success?: boolean, metadata?: Record<string, any>): Promise<void> {
        const message = success ? 'Tool executed successfully' : 'Tool execution failed';
        const level: LogLevel = success ? 'info' : 'error';

        const logMetadata: any = {
            executionId,
            operation: 'tool_execution',
            ...metadata
        };

        if (duration !== undefined) {
            logMetadata.duration = duration;
        }

        await this.log(level, message, { toolName, success }, logMetadata);
    }

    /**
     * Flush any pending logs
     */
    async flush(): Promise<void> {
        try {
            await this.storage.flush();
        } catch (error) {
            throw new PluginError('Failed to flush logs', this.name, {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Cleanup resources
     */
    async destroy(): Promise<void> {
        try {
            await this.storage.close();
            this.logger.info('LoggingPlugin destroyed');
        } catch (error) {
            this.logger.error('Error during plugin cleanup', { error });
        }
    }

    /**
     * Check if message should be logged based on level
     */
    private shouldLog(level: LogLevel): boolean {
        const currentLevelIndex = this.logLevels.indexOf(this.options.level);
        const messageLevelIndex = this.logLevels.indexOf(level);
        return messageLevelIndex >= currentLevelIndex;
    }

    /**
     * Validate plugin options
     */
    private validateOptions(options: LoggingPluginOptions): void {
        if (!options.strategy) {
            throw new ConfigurationError('Logging strategy is required');
        }

        if (!['console', 'file', 'remote', 'silent'].includes(options.strategy)) {
            throw new ConfigurationError('Invalid logging strategy', {
                validStrategies: ['console', 'file', 'remote', 'silent'],
                provided: options.strategy
            });
        }

        if (options.level && !['debug', 'info', 'warn', 'error'].includes(options.level)) {
            throw new ConfigurationError('Invalid log level', {
                validLevels: ['debug', 'info', 'warn', 'error'],
                provided: options.level
            });
        }

        if (options.strategy === 'file' && !options.filePath) {
            throw new ConfigurationError('File path is required for file logging strategy');
        }

        if (options.strategy === 'remote' && !options.remoteEndpoint) {
            throw new ConfigurationError('Remote endpoint is required for remote logging strategy');
        }

        if (options.maxLogs !== undefined && options.maxLogs <= 0) {
            throw new ConfigurationError('Max logs must be positive');
        }

        if (options.batchSize !== undefined && options.batchSize <= 0) {
            throw new ConfigurationError('Batch size must be positive');
        }

        if (options.flushInterval !== undefined && options.flushInterval <= 0) {
            throw new ConfigurationError('Flush interval must be positive');
        }
    }

    /**
     * Create storage instance based on strategy
     */
    private createStorage(): LogStorage {
        const formatter = this.options.formatter;

        switch (this.options.strategy) {
            case 'console':
                return new ConsoleLogStorage(formatter);
            case 'file':
                return new FileLogStorage(this.options.filePath, formatter);
            case 'remote':
                return new RemoteLogStorage(
                    this.options.remoteEndpoint,
                    this.options.remoteHeaders,
                    formatter,
                    this.options.batchSize,
                    this.options.flushInterval
                );
            case 'silent':
                return new SilentLogStorage();
            default:
                throw new ConfigurationError('Unknown logging strategy', { strategy: this.options.strategy });
        }
    }
} 