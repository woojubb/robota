import type { IOpenAILogData } from '../types/api-types';
import type { ILogger } from '@robota-sdk/agent-core';

/**
 * IPayloadLogger interface for logging a summary of each OpenAI Chat Completions request
 * (request metadata such as model, message count and whether tools were sent — not prompt or
 * response content).
 *
 * This interface provides a contract for different logging implementations:
 * - FilePayloadLogger: Node.js file-based logging
 * - ConsolePayloadLogger: Browser console-based logging
 * - Custom implementations: User-defined loggers
 */
export interface IPayloadLogger {
  /**
   * Check if logging is enabled
   * @returns true if logging is active, false otherwise
   */
  isEnabled(): boolean;

  /**
   * Log a request summary
   * @param payload - Summary of the outgoing Chat Completions request
   * @param type - Type of operation ('chat' or 'stream')
   */
  logPayload(payload: IOpenAILogData, type: 'chat' | 'stream'): Promise<void>;
}

/**
 * Configuration options for payload loggers
 */
export interface IPayloadLoggerOptions {
  /**
   * Whether logging is enabled
   * @defaultValue true
   */
  enabled?: boolean;

  /**
   * Include timestamp in log entries
   * @defaultValue true
   */
  includeTimestamp?: boolean;

  /**
   * Logger instance for console output
   * @defaultValue SilentLogger
   */
  logger?: ILogger;
}
