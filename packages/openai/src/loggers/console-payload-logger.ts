import type { IPayloadLogger, IPayloadLoggerOptions } from '../interfaces/payload-logger';
import type { IOpenAILogData } from '../types/api-types';
import { SilentLogger, type ILogger } from '@robota-sdk/agents';
import { sanitizeOpenAILogData } from './sanitize-openai-log-data';

/**
 * Console-based payload logger for browser environments
 * 
 * This logger outputs API request/response payloads to the browser console
 * using structured logging. It's designed specifically for browser environments
 * and development/debugging scenarios.
 * 
 * @example
 * ```typescript
 * import { ConsolePayloadLogger } from '@robota-sdk/openai/loggers/console';
 * 
 * const logger = new ConsolePayloadLogger({
 *   enabled: true,
 *   includeTimestamp: true
 * });
 * 
 * const provider = new OpenAIProvider({
 *   client: openaiClient,
 *   payloadLogger: logger
 * });
 * ```
 */
export class ConsolePayloadLogger implements IPayloadLogger {
    private readonly enabled: boolean;
    private readonly includeTimestamp: boolean;
    private readonly logger: ILogger;

    constructor(options: IPayloadLoggerOptions = {}) {
        this.enabled = options.enabled ?? true;
        this.includeTimestamp = options.includeTimestamp ?? true;
        this.logger = options.logger || SilentLogger;
    }

    /**
     * Check if logging is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Log API payload to browser console
     * @param payload - The API request payload
     * @param type - Type of request ('chat' or 'stream')
     */
    async logPayload(payload: IOpenAILogData, type: 'chat' | 'stream' = 'chat'): Promise<void> {
        if (!this.enabled) {
            return;
        }

        try {
            const sanitizedPayload = sanitizeOpenAILogData(payload);

            // Use structured console logging for better browser developer tools integration
            const title = `[OpenAI ${type.toUpperCase()}] API Payload`;
            const timeInfo = this.includeTimestamp ? ` (${sanitizedPayload.timestamp})` : '';

            // Group related log entries for better organization
            this.logger.group?.(`${title}${timeInfo}`);

            // Log different aspects with appropriate console methods
            this.logger.info('📋 Request Details:', {
                model: payload.model,
                messagesCount: payload.messagesCount,
                hasTools: payload.hasTools,
                temperature: payload.temperature,
                maxTokens: payload.maxTokens
            });

            this.logger.debug('🔍 Full Payload:', { type, provider: 'openai', ...sanitizedPayload });

            this.logger.groupEnd?.();

        } catch (error) {
            // Don't throw errors - just log them and continue
            // This ensures that API logging failures don't break the main functionality
            this.logger.error('[ConsolePayloadLogger] Failed to log payload:', error instanceof Error ? error.message : 'Unknown error');
        }
    }

    /**
     * Sanitize payload to remove sensitive information
     * @param payload - Raw payload object
     * @returns Sanitized payload
     */
    // Sanitization intentionally lives in ./sanitize-openai-log-data.ts (SSOT utility).
} 