import * as fs from 'fs';
import * as path from 'path';

/**
 * Utility class for logging OpenAI API payloads to files
 */
export class PayloadLogger {
    private readonly enabled: boolean;
    private readonly logDir: string;
    private readonly includeTimestamp: boolean;

    constructor(
        enabled: boolean = false,
        logDir: string = './logs/api-payloads',
        includeTimestamp: boolean = true
    ) {
        this.enabled = enabled;
        this.logDir = logDir;
        this.includeTimestamp = includeTimestamp;

        if (this.enabled) {
            this.ensureLogDirectoryExists();
        }
    }

    /**
     * Log API payload to file
     * @param payload - The API request payload
     * @param type - Type of request ('chat' or 'stream')
     */
    async logPayload(payload: any, type: 'chat' | 'stream' = 'chat'): Promise<void> {
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

            // Payload saved successfully
        } catch (error) {
            // Don't throw errors - just log them and continue
            // Failed to save payload log file - silently continue
        }
    }

    /**
     * Ensure log directory exists
     */
    private ensureLogDirectoryExists(): void {
        if (!fs.existsSync(this.logDir)) {
            try {
                fs.mkdirSync(this.logDir, { recursive: true });
                // Log directory created successfully
            } catch (error) {
                // Don't throw errors - just log them and disable logging
                // Failed to create log directory - payload logging will be disabled
                // Note: We don't disable this.enabled here as it's readonly, but errors will be caught in logPayload
            }
        }
    }

    /**
     * Sanitize payload to remove sensitive information
     * @param payload - Raw payload object
     * @returns Sanitized payload
     */
    private sanitizePayload(payload: any): any {
        // Create a deep copy to avoid modifying original
        const sanitized = JSON.parse(JSON.stringify(payload));

        // Remove or mask sensitive data if needed
        // For now, we keep everything as OpenAI payloads don't contain API keys
        return sanitized;
    }

    /**
     * Check if logging is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }
} 