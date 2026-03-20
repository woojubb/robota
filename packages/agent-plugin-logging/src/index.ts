export { LoggingPlugin } from './logging-plugin';
export { ConsoleLogStorage } from './storages/console-storage';
export { FileLogStorage } from './storages/file-storage';
export { RemoteLogStorage } from './storages/remote-storage';
export { SilentLogStorage } from './storages/silent-storage';
export { ConsoleLogFormatter, JsonLogFormatter } from './formatters';
export type {
  TLoggingStrategy,
  TLogLevel,
  ILogEntry,
  ILoggingPluginOptions,
  ILoggingPluginStats,
  ILogFormatter,
  ILogStorage,
} from './types';
