import type { PayloadLogger, PayloadLoggerOptions } from '../interfaces/payload-logger';
import type { OpenAILogData } from '../types/api-types';
import { SimpleLogger, DefaultConsoleLogger } from '@robota-sdk/agents';

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
export class ConsolePayloadLogger implements PayloadLogger {
    private readonly enabled: boolean;
    private readonly includeTimestamp: boolean;
    private readonly logger: SimpleLogger;

    constructor(options: PayloadLoggerOptions = {}) {
        this.enabled = options.enabled ?? true;
        this.includeTimestamp = options.includeTimestamp ?? true;
        this.logger = options.logger || DefaultConsoleLogger;
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
    async logPayload(payload: OpenAILogData, type: 'chat' | 'stream' = 'chat'): Promise<void> {
        if (!this.enabled) {
            return;
        }

        try {
            const logData = {
                timestamp: new Date().toISOString(),
                type,
                provider: 'openai',
                payload: this.sanitizePayload(payload)
            };

            // Use structured console logging for better browser developer tools integration
            const title = `[OpenAI ${type.toUpperCase()}] API Payload`;
            const timeInfo = this.includeTimestamp ? ` (${logData.timestamp})` : '';

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

            this.logger.debug('🔍 Full Payload:', logData);

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
    private sanitizePayload(payload: OpenAILogData): OpenAILogData {
        // Create a deep copy to avoid modifying original
        const sanitized = JSON.parse(JSON.stringify(payload)) as OpenAILogData;

        // Remove or mask sensitive data if needed
        // For now, we keep everything as OpenAI payloads don't contain API keys
        return sanitized;
    }
} 