import {
  AbstractPlugin,
  PluginCategory,
  PluginPriority,
  createLogger,
  type ILogger,
  SilentLogger,
  PluginError,
  type IEventEmitterEventData,
  type TEventName,
} from '@robota-sdk/agent-core';

import {
  TLogLevel,
  ILogEntry,
  ILoggingPluginOptions,
  ILoggingPluginStats,
  ILogStorage,
  ILogFormatter,
} from './types';
import {
  validateLoggingOptions,
  createLoggingStorage,
  extractLoggingModuleData,
  LOGGING_MODULE_EVENT_MAP,
  logExecutionStartHelper,
  logExecutionCompleteHelper,
  logToolExecutionHelper,
} from './logging-helpers';

const DEFAULT_MAX_LOGS = 10000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_FLUSH_INTERVAL_MS = 30000;

/**
 * Logging context data - structured data for log entries
 */
export interface ILoggingContextData
  extends Record<string, string | number | boolean | Date | undefined> {
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
  private pluginOptions: Required<Omit<ILoggingPluginOptions, 'formatter' | 'logger'>> & {
    formatter?: ILogFormatter;
    logger?: ILogger;
  };
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
    validateLoggingOptions(options);

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
    this.storage = createLoggingStorage(
      this.pluginOptions.strategy,
      this.pluginOptions.filePath,
      this.pluginOptions.remoteEndpoint,
      this.pluginOptions.flushInterval,
      this.pluginOptions.formatter,
    );

    this.logger.info('LoggingPlugin initialized', {
      strategy: this.pluginOptions.strategy,
      level: this.pluginOptions.level,
      maxLogs: this.pluginOptions.maxLogs,
    });
  }

  /**
   * Routes module lifecycle events (initialize, execute, dispose) to the
   * appropriate log level. Errors are logged but never re-thrown.
   */
  override async onModuleEvent(
    eventName: TEventName,
    eventData: IEventEmitterEventData,
  ): Promise<void> {
    try {
      const descriptor = LOGGING_MODULE_EVENT_MAP.get(eventName);
      if (!descriptor) return;

      const { moduleName, moduleType, duration, success } = extractLoggingModuleData(
        eventData.data,
      );
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
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Writes a log entry to the configured storage if the level meets the
   * current threshold. Logging failures are swallowed to prevent cascading errors.
   */
  async log(
    level: TLogLevel,
    message: string,
    context?: ILoggingContextData,
    metadata?: ILogEntry['metadata'],
  ): Promise<void> {
    if (!this.shouldLog(level)) {
      return;
    }

    try {
      const entry: ILogEntry = {
        timestamp: new Date(),
        level,
        message,
        ...(context && { context }),
        ...(metadata && { metadata }),
      };

      await this.storage.write(entry);
    } catch (error) {
      // Don't throw errors from logging to avoid infinite loops
      this.simpleLogger.error(
        'Logging failed:',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /** Log debug message */
  async debug(
    message: string,
    context?: ILoggingContextData,
    metadata?: ILogEntry['metadata'],
  ): Promise<void> {
    await this.log('debug', message, context, metadata);
  }

  /** Log info message */
  async info(
    message: string,
    context?: ILoggingContextData,
    metadata?: ILogEntry['metadata'],
  ): Promise<void> {
    await this.log('info', message, context, metadata);
  }

  /** Log warning message */
  async warn(
    message: string,
    context?: ILoggingContextData,
    metadata?: ILogEntry['metadata'],
  ): Promise<void> {
    await this.log('warn', message, context, metadata);
  }

  /**
   * Log error message
   */
  async error(
    message: string,
    error?: Error,
    context?: ILoggingContextData,
    metadata?: ILogEntry['metadata'],
  ): Promise<void> {
    const errorContext = {
      ...context,
      ...(error && this.pluginOptions.includeStackTrace
        ? {
            errorMessage: error.message,
            errorStack: error.stack,
          }
        : {}),
    };

    await this.log('error', message, errorContext, metadata);
  }

  /**
   * Logs the start of an agent execution, truncating user input to 100 characters.
   */
  async logExecutionStart(
    executionId: string,
    userInput: string,
    metadata?: ILogEntry['metadata'],
  ): Promise<void> {
    await logExecutionStartHelper(this, executionId, userInput, metadata);
  }

  /**
   * Logs the completion of an agent execution with its duration.
   */
  async logExecutionComplete(
    executionId: string,
    duration: number,
    metadata?: ILogEntry['metadata'],
  ): Promise<void> {
    await logExecutionCompleteHelper(this, executionId, duration, metadata);
  }

  /**
   * Logs a tool execution result at info (success) or error (failure) level.
   */
  async logToolExecution(
    toolName: string,
    executionId: string,
    duration?: number,
    success?: boolean,
    metadata?: ILogEntry['metadata'],
  ): Promise<void> {
    await logToolExecutionHelper(this, toolName, executionId, duration, success, metadata);
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
        error: error instanceof Error ? error.message : String(error),
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
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Check if message should be logged based on level */
  private shouldLog(level: TLogLevel): boolean {
    const currentLevelIndex = this.logLevels.indexOf(this.pluginOptions.level);
    const messageLevelIndex = this.logLevels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }
}
