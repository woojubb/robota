import * as fs from 'fs';
import * as path from 'path';
import type { PayloadLogger } from '../interfaces/payload-logger';
import type { OpenAILogData } from '../types/api-types';

/**
 * File-based payload logger for Node.js environments
 * 
 * This logger saves API request/response payloads to JSON files on disk.
 * It's designed specifically for Node.js environments with filesystem access.
 * 
 * @example
 * ```typescript
 * import { FilePayloadLogger } from '@robota-sdk/openai/loggers/file';
 * 
 * const logger = new FilePayloadLogger({
 *   logDir: './logs/api-payloads',
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
export class FilePayloadLogger implements PayloadLogger {
    private readonly enabled: boolean;
    private readonly logDir: string;
    private readonly includeTimestamp: boolean;

    constructor(options: {
        logDir: string;
        enabled?: boolean;
        includeTimestamp?: boolean;
    }) {
        this.enabled = options.enabled ?? true;
        this.logDir = options.logDir;
        this.includeTimestamp = options.includeTimestamp ?? true;

        if (this.enabled) {
            this.ensureLogDirectoryExists();
        }
    }

    /**
     * Check if logging is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Log API payload to file
     * @param payload - The API request payload
     * @param type - Type of request ('chat' or 'stream')
     */
    async logPayload(payload: OpenAILogData, type: 'chat' | 'stream' = 'chat'): Promise<void> {
        if (!this.enabled) {
            return;
        }

        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = this.includeTimestamp
                ? `openai-${type}-${timestamp}.json`
                : `openai-${type}-${Date.now()}.json`;

            const filepath = path.join(this.logDir, filename);

            const logData = {
                timestamp: new Date().toISOString(),
                type,
                provider: 'openai',
                payload: this.sanitizePayload(payload)
            };

            await fs.promises.writeFile(
                filepath,
                JSON.stringify(logData, null, 2),
                'utf8'
            );

            // Payload saved successfully (silent operation)
        } catch (error) {
            // Don't throw errors - just log them and continue
            // This ensures that API logging failures don't break the main functionality
            // eslint-disable-next-line no-console
            console.error('[FilePayloadLogger] Failed to save payload log:', error instanceof Error ? error.message : 'Unknown error');
        }
    }

    /**
     * Ensure log directory exists
     */
    private ensureLogDirectoryExists(): void {
        try {
            if (!fs.existsSync(this.logDir)) {
                fs.mkdirSync(this.logDir, { recursive: true });
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('[FilePayloadLogger] Failed to create log directory:', error instanceof Error ? error.message : 'Unknown error');
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