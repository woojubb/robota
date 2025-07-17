import type { OpenAILogData } from '../types/api-types';
import type { SimpleLogger } from '@robota-sdk/agents';

/**
 * PayloadLogger interface for logging OpenAI API payloads
 * 
 * This interface provides a contract for different logging implementations:
 * - FilePayloadLogger: Node.js file-based logging
 * - ConsolePayloadLogger: Browser console-based logging
 * - Custom implementations: User-defined loggers
 */
export interface PayloadLogger {
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
    logPayload(payload: OpenAILogData, type: 'chat' | 'stream'): Promise<void>;
}

/**
 * Configuration options for payload loggers
 */
export interface PayloadLoggerOptions {
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
     * @defaultValue DefaultConsoleLogger
     */
    logger?: SimpleLogger;
} 