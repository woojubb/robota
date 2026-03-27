/**
 * Logging Plugin - Validation and storage factory helpers.
 *
 * Extracted from logging-plugin.ts to keep each file under 300 lines.
 * @internal
 */

import { ConfigurationError, EVENT_EMITTER_EVENTS } from '@robota-sdk/agent-core';
import {
  ConsoleLogStorage,
  FileLogStorage,
  RemoteLogStorage,
  SilentLogStorage,
} from './storages/index';
import type { ILoggingPluginOptions, ILogStorage, TLogLevel, ILogEntry } from './types';

/** Validate LoggingPlugin constructor options. @internal */
export function validateLoggingOptions(options: ILoggingPluginOptions): void {
  if (!options.strategy) {
    throw new ConfigurationError('Logging strategy is required');
  }

  if (!['console', 'file', 'remote', 'silent'].includes(options.strategy)) {
    throw new ConfigurationError('Invalid logging strategy', {
      validStrategies: ['console', 'file', 'remote', 'silent'],
      provided: options.strategy,
    });
  }

  if (options.level && !['debug', 'info', 'warn', 'error'].includes(options.level)) {
    throw new ConfigurationError('Invalid log level', {
      validLevels: ['debug', 'info', 'warn', 'error'],
      provided: options.level,
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

/** Create ILogStorage instance for the given strategy. @internal */
export function createLoggingStorage(
  strategy: string,
  filePath: string,
  remoteEndpoint: string,
  flushInterval: number,
  formatter?: ILoggingPluginOptions['formatter'],
): ILogStorage {
  switch (strategy) {
    case 'console':
      return new ConsoleLogStorage(formatter);
    case 'file':
      return new FileLogStorage(filePath, formatter);
    case 'remote':
      return new RemoteLogStorage(remoteEndpoint, { timeout: flushInterval });
    case 'silent':
      return new SilentLogStorage();
    default:
      throw new ConfigurationError('Unknown logging strategy', { strategy });
  }
}

/** Event name → log descriptor mapping for module lifecycle events. @internal */
export const LOGGING_MODULE_EVENT_MAP: ReadonlyMap<
  string,
  { level: TLogLevel; message: string; operation: string }
> = new Map([
  [
    EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_START,
    {
      level: 'info',
      message: 'Module initialization started',
      operation: 'module_initialize_start',
    },
  ],
  [
    EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_COMPLETE,
    {
      level: 'info',
      message: 'Module initialization completed',
      operation: 'module_initialize_complete',
    },
  ],
  [
    EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_ERROR,
    {
      level: 'error',
      message: 'Module initialization failed',
      operation: 'module_initialize_error',
    },
  ],
  [
    EVENT_EMITTER_EVENTS.MODULE_EXECUTION_START,
    { level: 'debug', message: 'Module execution started', operation: 'module_execution_start' },
  ],
  [
    EVENT_EMITTER_EVENTS.MODULE_EXECUTION_COMPLETE,
    {
      level: 'debug',
      message: 'Module execution completed',
      operation: 'module_execution_complete',
    },
  ],
  [
    EVENT_EMITTER_EVENTS.MODULE_EXECUTION_ERROR,
    { level: 'error', message: 'Module execution failed', operation: 'module_execution_error' },
  ],
  [
    EVENT_EMITTER_EVENTS.MODULE_DISPOSE_START,
    { level: 'debug', message: 'Module disposal started', operation: 'module_dispose_start' },
  ],
  [
    EVENT_EMITTER_EVENTS.MODULE_DISPOSE_COMPLETE,
    { level: 'info', message: 'Module disposal completed', operation: 'module_dispose_complete' },
  ],
  [
    EVENT_EMITTER_EVENTS.MODULE_DISPOSE_ERROR,
    { level: 'error', message: 'Module disposal failed', operation: 'module_dispose_error' },
  ],
]);

/** Safely extract module data fields from untyped event payload. @internal */
export function extractLoggingModuleData(data: unknown): {
  moduleName: string;
  moduleType: string;
  duration?: number;
  success?: boolean;
} {
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  return {
    moduleName: typeof record['moduleName'] === 'string' ? record['moduleName'] : 'unknown',
    moduleType: typeof record['moduleType'] === 'string' ? record['moduleType'] : 'unknown',
    ...(typeof record['duration'] === 'number' && { duration: record['duration'] }),
    ...(typeof record['success'] === 'boolean' && { success: record['success'] }),
  };
}

/** Narrow interface for the log methods needed by convenience helpers. @internal */
export interface ILogWriter {
  info(
    message: string,
    context?: Record<string, string | number | boolean | Date | undefined>,
    metadata?: ILogEntry['metadata'],
  ): Promise<void>;
  log(
    level: TLogLevel,
    message: string,
    context?: Record<string, string | number | boolean | Date | undefined>,
    metadata?: ILogEntry['metadata'],
  ): Promise<void>;
}

const PREVIEW_LENGTH_HELPER = 100;

/** Log execution start with truncated user input. @internal */
export async function logExecutionStartHelper(
  writer: ILogWriter,
  executionId: string,
  userInput: string,
  metadata?: ILogEntry['metadata'],
): Promise<void> {
  await writer.info(
    'Execution started',
    { userInput: userInput.substring(0, PREVIEW_LENGTH_HELPER) },
    { executionId, operation: 'execution_start', ...metadata },
  );
}

/** Log execution completion with duration. @internal */
export async function logExecutionCompleteHelper(
  writer: ILogWriter,
  executionId: string,
  duration: number,
  metadata?: ILogEntry['metadata'],
): Promise<void> {
  await writer.info(
    'Execution completed',
    { duration },
    {
      executionId,
      operation: 'execution_complete',
      ...(duration !== undefined && { duration }),
      ...metadata,
    },
  );
}

/** Log a tool execution result at info (success) or error (failure) level. @internal */
export async function logToolExecutionHelper(
  writer: ILogWriter,
  toolName: string,
  executionId: string,
  duration?: number,
  success?: boolean,
  metadata?: ILogEntry['metadata'],
): Promise<void> {
  const message = success ? 'Tool executed successfully' : 'Tool execution failed';
  const level: TLogLevel = success ? 'info' : 'error';
  const logMetadata = {
    executionId,
    operation: 'tool_execution',
    ...(duration !== undefined && { duration }),
    ...(metadata && typeof metadata === 'object' ? metadata : {}),
  } as ILogEntry['metadata'];
  await writer.log(level, message, { toolName, success: success ?? false }, logMetadata);
}
