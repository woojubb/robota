import { AbstractPlugin, PluginCategory, PluginPriority } from '../../abstracts/abstract-plugin';
import { createLogger, type ILogger } from '../../utils/logger';
import { SilentLogger } from '../../utils/logger';
import { PluginError, ConfigurationError } from '../../utils/errors';
import type { IEventEmitterEventData, TEventName } from '../event-emitter-plugin';
import { EVENT_EMITTER_EVENTS } from '../event-emitter/types';

import {
    TLogLevel,
    ILogEntry,
    ILoggingPluginOptions,
    ILoggingPluginStats,
    ILogStorage,
    ILogFormatter
} from './types';
import {
    ConsoleLogStorage,
    FileLogStorage,
    RemoteLogStorage,
    SilentLogStorage
} from './storages/index';

const DEFAULT_MAX_LOGS = 10000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_FLUSH_INTERVAL_MS = 30000;
const PREVIEW_LENGTH = 100;

/**
 * Logging context data - structured data for log entries
 */
export interface ILoggingContextData extends Record<string, string | number | boolean | Date | undefined> {
    userInput?: string;
    duration?: number;
    toolName?: string;
    success?: boolean;
    executionId?: string;
    operation?: string;
    errorMessage?: string;
    errorStack?: string;
    inputLength?: number;
    responseLength?: number;
    hasOptions?: boolean;
    modelName?: string;
}

/**
 * Logs agent operations using configurable storage backends.
 *
 * Supports console, file, remote, and silent strategies with configurable log
 * levels and optional formatting via {@link ILogFormatter} implementations.
 *
 * Lifecycle hooks used: {@link AbstractPlugin.onModuleEvent | onModuleEvent}
 *
 * @extends AbstractPlugin
 * @see ILogStorage - storage backend contract
 * @see ILogFormatter - log formatting contract
 * @see ILoggingPluginOptions - configuration options
 *
 * @example
 * ```ts
 * const plugin = new LoggingPlugin({
 *   strategy: 'console',
 *   level: 'info',
 * });
 * await plugin.info('Agent started');
 * ```
 */
export class LoggingPlugin extends AbstractPlugin<ILoggingPluginOptions, ILoggingPluginStats> {
    name = 'LoggingPlugin';
    version = '1.0.0';

    private storage: ILogStorage;
    private pluginOptions: Required<Omit<ILoggingPluginOptions, 'formatter' | 'logger'>> & { formatter?: ILogFormatter; logger?: ILogger };
    private logger: ILogger;
    private simpleLogger: ILogger;
    private logLevels: TLogLevel[] = ['debug', 'info', 'warn', 'error'];

    constructor(options: ILoggingPluginOptions) {
        super();
        this.logger = createLogger('LoggingPlugin');
        this.simpleLogger = options.logger || SilentLogger;

        // Set plugin classification
        this.category = PluginCategory.LOGGING;
        this.priority = PluginPriority.HIGH;

        // Validate options
        this.validateOptions(options);

        // Set defaults
        this.pluginOptions = {
            enabled: options.enabled ?? true,
            strategy: options.strategy,
            level: options.level ?? 'info',
            filePath: options.filePath ?? './agent.log',
            remoteEndpoint: options.remoteEndpoint ?? '',
            remoteHeaders: options.remoteHeaders ?? {},
            maxLogs: options.maxLogs ?? DEFAULT_MAX_LOGS,
            includeStackTrace: options.includeStackTrace ?? true,
            ...(options.formatter && { formatter: options.formatter }),
            batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
            flushInterval: options.flushInterval ?? DEFAULT_FLUSH_INTERVAL_MS,
            // Add plugin options defaults
            category: options.category ?? PluginCategory.LOGGING,
            priority: options.priority ?? PluginPriority.HIGH,
            moduleEvents: options.moduleEvents ?? [],
            subscribeToAllModuleEvents: options.subscribeToAllModuleEvents ?? false,
        };

        // Initialize storage
        this.storage = this.createStorage();

        this.logger.info('LoggingPlugin initialized', {
            strategy: this.pluginOptions.strategy,
            level: this.pluginOptions.level,
            maxLogs: this.pluginOptions.maxLogs
        });
    }

    /** Event name → log descriptor mapping. Eliminates the 9-case switch statement. */
    private static readonly MODULE_EVENT_MAP: ReadonlyMap<string, { level: TLogLevel; message: string; operation: string }> = new Map([
        [EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_START, { level: 'info', message: 'Module initialization started', operation: 'module_initialize_start' }],
        [EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_COMPLETE, { level: 'info', message: 'Module initialization completed', operation: 'module_initialize_complete' }],
        [EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_ERROR, { level: 'error', message: 'Module initialization failed', operation: 'module_initialize_error' }],
        [EVENT_EMITTER_EVENTS.MODULE_EXECUTION_START, { level: 'debug', message: 'Module execution started', operation: 'module_execution_start' }],
        [EVENT_EMITTER_EVENTS.MODULE_EXECUTION_COMPLETE, { level: 'debug', message: 'Module execution completed', operation: 'module_execution_complete' }],
        [EVENT_EMITTER_EVENTS.MODULE_EXECUTION_ERROR, { level: 'error', message: 'Module execution failed', operation: 'module_execution_error' }],
        [EVENT_EMITTER_EVENTS.MODULE_DISPOSE_START, { level: 'debug', message: 'Module disposal started', operation: 'module_dispose_start' }],
        [EVENT_EMITTER_EVENTS.MODULE_DISPOSE_COMPLETE, { level: 'info', message: 'Module disposal completed', operation: 'module_dispose_complete' }],
        [EVENT_EMITTER_EVENTS.MODULE_DISPOSE_ERROR, { level: 'error', message: 'Module disposal failed', operation: 'module_dispose_error' }],
    ]);

    /**
     * Routes module lifecycle events (initialize, execute, dispose) to the
     * appropriate log level. Errors are logged but never re-thrown.
     */
    override async onModuleEvent(eventName: TEventName, eventData: IEventEmitterEventData): Promise<void> {
        try {
            const descriptor = LoggingPlugin.MODULE_EVENT_MAP.get(eventName);
            if (!descriptor) return;

            const { moduleName, moduleType, duration, success } = LoggingPlugin.extractModuleData(eventData.data);
            const context: ILoggingContextData = { moduleName, moduleType };
            if (duration !== undefined) context.duration = duration;
            if (success !== undefined) context.success = success;

            const metadata: ILogEntry['metadata'] = { operation: descriptor.operation };
            if (eventData.executionId) metadata.executionId = eventData.executionId;
            if (duration !== undefined) metadata.duration = duration;

            const isErrorEvent = descriptor.level === 'error';
            if (isErrorEvent) {
                await this.error(descriptor.message, eventData.error, context, metadata);
            } else {
                await this.log(descriptor.level, descriptor.message, context, metadata);
            }
        } catch (error) {
            this.simpleLogger.error(
                `LoggingPlugin failed to handle module event ${eventName}:`,
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    /** Safely extracts module data fields from untyped event data. */
    private static extractModuleData(data: unknown): {
        moduleName: string;
        moduleType: string;
        duration?: number;
        success?: boolean;
    } {
        const record = (typeof data === 'object' && data !== null) ? data as Record<string, unknown> : {};
        return {
            moduleName: typeof record['moduleName'] === 'string' ? record['moduleName'] : 'unknown',
            moduleType: typeof record['moduleType'] === 'string' ? record['moduleType'] : 'unknown',
            ...(typeof record['duration'] === 'number' && { duration: record['duration'] }),
            ...(typeof record['success'] === 'boolean' && { success: record['success'] }),
        };
    }

    /**
     * Writes a log entry to the configured storage if the level meets the
     * current threshold. Logging failures are swallowed to prevent cascading errors.
     */
    async log(level: TLogLevel, message: string, context?: ILoggingContextData, metadata?: ILogEntry['metadata']): Promise<void> {
        if (!this.shouldLog(level)) {
            return;
        }

        try {
            const entry: ILogEntry = {
                timestamp: new Date(),
                level,
                message,
                ...(context && { context }),
                ...(metadata && { metadata })
            };

            await this.storage.write(entry);
        } catch (error) {
            // Don't throw errors from logging to avoid infinite loops
            this.simpleLogger.error('Logging failed:', error instanceof Error ? error : new Error(String(error)));
        }
    }

    /**
     * Log debug message
     */
    async debug(message: string, context?: ILoggingContextData, metadata?: ILogEntry['metadata']): Promise<void> {
        await this.log('debug', message, context, metadata);
    }

    /**
     * Log info message
     */
    async info(message: string, context?: ILoggingContextData, metadata?: ILogEntry['metadata']): Promise<void> {
        await this.log('info', message, context, metadata);
    }

    /**
     * Log warning message
     */
    async warn(message: string, context?: ILoggingContextData, metadata?: ILogEntry['metadata']): Promise<void> {
        await this.log('warn', message, context, metadata);
    }

    /**
     * Log error message
     */
    async error(message: string, error?: Error, context?: ILoggingContextData, metadata?: ILogEntry['metadata']): Promise<void> {
        const errorContext = {
            ...context,
            ...(error && this.pluginOptions.includeStackTrace ? {
                errorMessage: error.message,
                errorStack: error.stack
            } : {})
        };

        await this.log('error', message, errorContext, metadata);
    }

    /**
     * Logs the start of an agent execution, truncating user input to 100 characters.
     */
    async logExecutionStart(executionId: string, userInput: string, metadata?: ILogEntry['metadata']): Promise<void> {
        await this.info('Execution started', { userInput: userInput.substring(0, PREVIEW_LENGTH) }, {
            executionId,
            operation: 'execution_start',
            ...metadata
        });
    }

    /**
     * Logs the completion of an agent execution with its duration.
     */
    async logExecutionComplete(executionId: string, duration: number, metadata?: ILogEntry['metadata']): Promise<void> {
        await this.info('Execution completed', { duration }, {
            executionId,
            operation: 'execution_complete',
            ...(duration !== undefined && { duration }),
            ...metadata
        });
    }

    /**
     * Logs a tool execution result at info (success) or error (failure) level.
     */
    async logToolExecution(toolName: string, executionId: string, duration?: number, success?: boolean, metadata?: ILogEntry['metadata']): Promise<void> {
        const message = success ? 'Tool executed successfully' : 'Tool execution failed';
        const level: TLogLevel = success ? 'info' : 'error';

        const logMetadata = {
            executionId,
            operation: 'tool_execution',
            ...(duration !== undefined && { duration }),
            ...(metadata && typeof metadata === 'object' ? metadata : {})
        } as ILogEntry['metadata'];

        await this.log(level, message, { toolName, success: success ?? false }, logMetadata);
    }

    /**
     * Flushes any buffered log entries to the underlying storage.
     * @throws PluginError if the flush operation fails
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
     * Closes the underlying storage and releases resources.
     */
    async destroy(): Promise<void> {
        try {
            await this.storage.close();
            this.logger.info('LoggingPlugin destroyed');
        } catch (error) {
            this.logger.error('Error during plugin cleanup', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Check if message should be logged based on level
     */
    private shouldLog(level: TLogLevel): boolean {
        const currentLevelIndex = this.logLevels.indexOf(this.pluginOptions.level);
        const messageLevelIndex = this.logLevels.indexOf(level);
        return messageLevelIndex >= currentLevelIndex;
    }

    /**
     * Validate plugin options
     */
    private validateOptions(options: ILoggingPluginOptions): void {
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
    private createStorage(): ILogStorage {
        const formatter = this.pluginOptions.formatter;

        switch (this.pluginOptions.strategy) {
            case 'console':
                return new ConsoleLogStorage(formatter);
            case 'file':
                return new FileLogStorage(this.pluginOptions.filePath, formatter);
            case 'remote':
                return new RemoteLogStorage(
                    this.pluginOptions.remoteEndpoint,
                    { timeout: this.pluginOptions.flushInterval }
                );
            case 'silent':
                return new SilentLogStorage();
            default:
                throw new ConfigurationError('Unknown logging strategy', { strategy: this.pluginOptions.strategy });
        }
    }
} 