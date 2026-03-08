import type { IOpenAILogData } from '../types/api-types';
import type { ILogger } from '@robota-sdk/agents';

/**
 * IPayloadLogger interface for logging OpenAI API payloads
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
     * Log API payload data
     * @param payload - The API request/response payload data
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