import type { TLoggerData, TUniversalValue } from '../interfaces/types';

/**
 * Reusable type definitions for logger utility
 */

/**
 * Log levels for the logger
 */
export type TUtilLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Log entry structure
 */
export interface IUtilLogEntry {
  timestamp: string;
  level: TUtilLogLevel;
  message: string;
  context?: TLoggerData;
  packageName?: string;
}

/**
 * Logger interface
 */
export interface ILogger {
  debug(...args: Array<TUniversalValue | TLoggerData | Error>): void;
  info(...args: Array<TUniversalValue | TLoggerData | Error>): void;
  warn(...args: Array<TUniversalValue | TLoggerData | Error>): void;
  error(...args: Array<TUniversalValue | TLoggerData | Error>): void;
  log(...args: Array<TUniversalValue | TLoggerData | Error>): void;
  group?(label?: string): void;
  groupEnd?(): void;
}

/**
 * Silent logger that does nothing (Null Object Pattern)
 *
 * IMPORTANT:
 * - This library must not write to stdio by default.
 * - Inject a real logger explicitly if you want output.
 */
export const SilentLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  log: () => {},
  group: () => {},
  groupEnd: () => {},
};

/**
 * Global logger configuration
 */
class LoggerConfig {
  private static instance: LoggerConfig;
  private globalLevel: TUtilLogLevel;
  private globalSink: ILogger | undefined;

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

  getGlobalLevel(): TUtilLogLevel {
    return this.globalLevel;
  }

  setGlobalLevel(level: TUtilLogLevel): void {
    this.globalLevel = level;
  }

  getGlobalSink(): ILogger | undefined {
    return this.globalSink;
  }

  setGlobalSink(sink: ILogger | undefined): void {
    this.globalSink = sink;
  }
}

/**
 * Console logger implementation
 * @internal
 */
export class ConsoleLogger implements ILogger {
  private level?: TUtilLogLevel; // undefined means use global level
  private packageName: string;
  private explicitSink: ILogger | undefined;

  /**
   * CORE-029: the sink is resolved PER CALL, not frozen at construction.
   *
   * It used to be `logger || SilentLogger`, decided once in the constructor. No call site in the
   * repository ever passed one and there was no way to set one afterwards, so every diagnostic this
   * package emits — 157 `logger.*` calls, including "Robota initialization failed" and every
   * catch-and-log-only path — went to `SilentLogger` by construction. Not "was not configured":
   * could not be.
   *
   * Resolving late is what makes a host able to turn logging on at all, and it is also why a logger
   * created during module initialisation still honours a sink installed afterwards.
   */
  constructor(packageName: string, logger?: ILogger) {
    this.packageName = packageName;
    this.explicitSink = logger;
  }

  private get sinkLogger(): ILogger {
    return this.explicitSink ?? LoggerConfig.getInstance().getGlobalSink() ?? SilentLogger;
  }

  debug(...args: Array<TUniversalValue | TLoggerData | Error>): void {
    if (this.shouldLog('debug')) {
      const [message, context] = args;
      this.forward('debug', String(message ?? ''), isLoggerContext(context) ? context : undefined);
    }
  }

  info(...args: Array<TUniversalValue | TLoggerData | Error>): void {
    if (this.shouldLog('info')) {
      const [message, context] = args;
      this.forward('info', String(message ?? ''), isLoggerContext(context) ? context : undefined);
    }
  }

  warn(...args: Array<TUniversalValue | TLoggerData | Error>): void {
    if (this.shouldLog('warn')) {
      const [message, context] = args;
      this.forward('warn', String(message ?? ''), isLoggerContext(context) ? context : undefined);
    }
  }

  error(...args: Array<TUniversalValue | TLoggerData | Error>): void {
    if (this.shouldLog('error')) {
      const [message, context] = args;
      this.forward('error', String(message ?? ''), isLoggerContext(context) ? context : undefined);
    }
  }

  log(...args: Array<TUniversalValue | TLoggerData | Error>): void {
    // Alias for info-level output (when enabled).
    this.info(...args);
  }

  private getLevel(): TUtilLogLevel {
    return this.level || LoggerConfig.getInstance().getGlobalLevel();
  }

  private shouldLog(level: TUtilLogLevel): boolean {
    const currentLevel = this.getLevel();
    if (currentLevel === 'silent') return false;

    const levels: TUtilLogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];
    return levels.indexOf(level) >= levels.indexOf(currentLevel);
  }

  private forward(level: TUtilLogLevel, message: string, context?: TLoggerData): void {
    const entry: IUtilLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context && { context }),
      packageName: this.packageName,
    };

    const formattedMessage = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.packageName}] ${entry.message}`;
    switch (level) {
      case 'debug':
        this.sinkLogger.debug(formattedMessage, context ?? {});
        return;
      case 'info':
        this.sinkLogger.info(formattedMessage, context ?? {});
        return;
      case 'warn':
        this.sinkLogger.warn(formattedMessage, context ?? {});
        return;
      case 'error':
        this.sinkLogger.error(formattedMessage, context ?? {});
        return;
      case 'silent':
        return;
    }
  }
}

function isLoggerContext(value: unknown): value is TLoggerData {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Error) &&
    !(value instanceof Date) &&
    !Array.isArray(value)
  );
}

/**
 * Create a named logger instance for a package or module.
 * Use this to create loggers with a specific name prefix for easy log filtering.
 */
export function createLogger(packageName: string, logger?: ILogger): ILogger {
  return new ConsoleLogger(packageName, logger);
}

/**
 * Set global log level for all loggers
 */
export function setGlobalLogLevel(level: TUtilLogLevel): void {
  LoggerConfig.getInstance().setGlobalLevel(level);
}

/**
 * Get global log level
 */
export function getGlobalLogLevel(): TUtilLogLevel {
  return LoggerConfig.getInstance().getGlobalLevel();
}

/**
 * Install the process-wide sink every logger writes to. CORE-029.
 *
 * Without this there was no way to receive anything this package logs: `createLogger`'s optional
 * sink parameter had no caller anywhere in the repository, and nothing could supply one later, so
 * `SilentLogger` was not a default — it was the only reachable outcome.
 *
 * The default stays SILENT. A library that starts writing to `console` because it was imported is a
 * different defect, so turning diagnostics on remains something a host does deliberately. Pass
 * `undefined` to go back to silence.
 */
export function setGlobalLoggerSink(sink: ILogger | undefined): void {
  LoggerConfig.getInstance().setGlobalSink(sink);
}

/** The installed process-wide sink, or `undefined` when diagnostics are going nowhere. */
export function getGlobalLoggerSink(): ILogger | undefined {
  return LoggerConfig.getInstance().getGlobalSink();
}

/**
 * Default logger for the agents package
 */
export const logger = createLogger('agents');
