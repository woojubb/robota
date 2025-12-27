import { AbstractPlugin, PluginCategory, PluginPriority } from '../../abstracts/abstract-plugin';
import { createLogger, type ILogger } from '../../utils/logger';
import { SimpleLogger, SilentLogger } from '../../utils/simple-logger';
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
 * Plugin for logging agent operations
 * Supports multiple logging strategies: console, file, remote, silent
 */
export class LoggingPlugin extends AbstractPlugin<ILoggingPluginOptions, ILoggingPluginStats> {
    name = 'LoggingPlugin';
    version = '1.0.0';

    private storage: ILogStorage;
    private pluginOptions: Required<Omit<ILoggingPluginOptions, 'formatter' | 'logger'>> & { formatter?: ILogFormatter; logger?: SimpleLogger };
    private logger: ILogger;
    private simpleLogger: SimpleLogger;
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
            maxLogs: options.maxLogs ?? 10000,
            includeStackTrace: options.includeStackTrace ?? true,
            ...(options.formatter && { formatter: options.formatter }),
            batchSize: options.batchSize ?? 100,
            flushInterval: options.flushInterval ?? 30000,
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

    /**
     * Handle module events for logging
     */
    override async onModuleEvent(eventName: TEventName, eventData: IEventEmitterEventData): Promise<void> {
        try {
            // Extract module event data from eventData.data
            const moduleData = eventData.data;

            switch (eventName) {
                case EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_START:
                    await this.info('Module initialization started', {
                        moduleName: (moduleData && 'moduleName' in moduleData && typeof moduleData['moduleName'] === 'string') ? moduleData['moduleName'] : 'unknown',
                        moduleType: (moduleData && 'moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown'
                    }, {
                        operation: 'module_initialize_start',
                        ...(eventData.executionId && { executionId: eventData.executionId })
                    });
                    break;

                case EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_COMPLETE:
                    await this.info('Module initialization completed', {
                        moduleName: (moduleData && 'moduleName' in moduleData && typeof moduleData['moduleName'] === 'string') ? moduleData['moduleName'] : 'unknown',
                        moduleType: (moduleData && 'moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown',
                        ...(moduleData && 'duration' in moduleData && typeof moduleData['duration'] === 'number' && { duration: moduleData['duration'] })
                    }, {
                        operation: 'module_initialize_complete',
                        ...(eventData.executionId && { executionId: eventData.executionId }),
                        ...(moduleData && 'duration' in moduleData && typeof moduleData['duration'] === 'number' && { duration: moduleData['duration'] })
                    });
                    break;

                case EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_ERROR:
                    await this.error('Module initialization failed', eventData.error, {
                        moduleName: (moduleData && 'moduleName' in moduleData && typeof moduleData['moduleName'] === 'string') ? moduleData['moduleName'] : 'unknown',
                        moduleType: (moduleData && 'moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown'
                    }, {
                        operation: 'module_initialize_error',
                        ...(eventData.executionId && { executionId: eventData.executionId })
                    });
                    break;

                case EVENT_EMITTER_EVENTS.MODULE_EXECUTION_START:
                    await this.debug('Module execution started', {
                        moduleName: (moduleData && 'moduleName' in moduleData && typeof moduleData['moduleName'] === 'string') ? moduleData['moduleName'] : 'unknown',
                        moduleType: (moduleData && 'moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown'
                    }, {
                        operation: 'module_execution_start',
                        ...(eventData.executionId && { executionId: eventData.executionId })
                    });
                    break;

                case EVENT_EMITTER_EVENTS.MODULE_EXECUTION_COMPLETE:
                    await this.debug('Module execution completed', {
                        moduleName: (moduleData && 'moduleName' in moduleData && typeof moduleData['moduleName'] === 'string') ? moduleData['moduleName'] : 'unknown',
                        moduleType: (moduleData && 'moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown',
                        ...(moduleData && 'duration' in moduleData && typeof moduleData['duration'] === 'number' && { duration: moduleData['duration'] }),
                        ...(moduleData && 'success' in moduleData && typeof moduleData['success'] === 'boolean' && { success: moduleData['success'] })
                    }, {
                        operation: 'module_execution_complete',
                        ...(eventData.executionId && { executionId: eventData.executionId }),
                        ...(moduleData && 'duration' in moduleData && typeof moduleData['duration'] === 'number' && { duration: moduleData['duration'] })
                    });
                    break;

                case EVENT_EMITTER_EVENTS.MODULE_EXECUTION_ERROR:
                    await this.error('Module execution failed', eventData.error, {
                        moduleName: (moduleData && 'moduleName' in moduleData && typeof moduleData['moduleName'] === 'string') ? moduleData['moduleName'] : 'unknown',
                        moduleType: (moduleData && 'moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown'
                    }, {
                        operation: 'module_execution_error',
                        ...(eventData.executionId && { executionId: eventData.executionId })
                    });
                    break;

                case EVENT_EMITTER_EVENTS.MODULE_DISPOSE_START:
                    await this.debug('Module disposal started', {
                        moduleName: (moduleData && 'moduleName' in moduleData && typeof moduleData['moduleName'] === 'string') ? moduleData['moduleName'] : 'unknown',
                        moduleType: (moduleData && 'moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown'
                    }, {
                        operation: 'module_dispose_start',
                        ...(eventData.executionId && { executionId: eventData.executionId })
                    });
                    break;

                case EVENT_EMITTER_EVENTS.MODULE_DISPOSE_COMPLETE:
                    await this.info('Module disposal completed', {
                        moduleName: (moduleData && 'moduleName' in moduleData && typeof moduleData['moduleName'] === 'string') ? moduleData['moduleName'] : 'unknown',
                        moduleType: (moduleData && 'moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown',
                        ...(moduleData && 'duration' in moduleData && typeof moduleData['duration'] === 'number' && { duration: moduleData['duration'] })
                    }, {
                        operation: 'module_dispose_complete',
                        ...(eventData.executionId && { executionId: eventData.executionId }),
                        ...(moduleData && 'duration' in moduleData && typeof moduleData['duration'] === 'number' && { duration: moduleData['duration'] })
                    });
                    break;

                case EVENT_EMITTER_EVENTS.MODULE_DISPOSE_ERROR:
                    await this.error('Module disposal failed', eventData.error, {
                        moduleName: (moduleData && 'moduleName' in moduleData && typeof moduleData['moduleName'] === 'string') ? moduleData['moduleName'] : 'unknown',
                        moduleType: (moduleData && 'moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown'
                    }, {
                        operation: 'module_dispose_error',
                        ...(eventData.executionId && { executionId: eventData.executionId })
                    });
                    break;
            }
        } catch (error) {
            // Log the error but don't throw to avoid breaking module event processing
            this.simpleLogger.error(`LoggingPlugin failed to handle module event ${eventName}:`, error);
        }
    }

    /**
     * Log a message
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
            this.simpleLogger.error('Logging failed:', error);
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
     * Log execution start
     */
    async logExecutionStart(executionId: string, userInput: string, metadata?: ILogEntry['metadata']): Promise<void> {
        await this.info('Execution started', { userInput: userInput.substring(0, 100) }, {
            executionId,
            operation: 'execution_start',
            ...metadata
        });
    }

    /**
     * Log execution completion
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
     * Log tool execution
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