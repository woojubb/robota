import * as fs from 'fs';
import * as path from 'path';

import { SilentLogger } from '@robota-sdk/agent-core';

import { sanitizeOpenAILogData } from './sanitize-openai-log-data';

import type { IPayloadLogger } from '../interfaces/payload-logger';
import type { IOpenAILogData } from '../types/api-types';
import type { ILogger } from '@robota-sdk/agent-core';

/** Owner-only access — no group or other bits (SEC-003 / CWE-377). */
const OWNER_ONLY_FILE_MODE = 0o600;
const OWNER_ONLY_DIR_MODE = 0o700;

/**
 * File-based payload logger for Node.js environments
 *
 * This logger saves API request/response payloads to JSON files on disk.
 * It's designed specifically for Node.js environments with filesystem access.
 *
 * @example
 * ```typescript
 * import { FilePayloadLogger } from '@robota-sdk/agent-provider/openai/loggers';
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
export class FilePayloadLogger implements IPayloadLogger {
  private readonly enabled: boolean;
  private readonly logDir: string;
  private readonly includeTimestamp: boolean;
  private readonly logger: ILogger;

  constructor(options: {
    logDir: string;
    enabled?: boolean;
    includeTimestamp?: boolean;
    logger?: ILogger;
  }) {
    this.enabled = options.enabled ?? true;
    this.logDir = options.logDir;
    this.includeTimestamp = options.includeTimestamp ?? true;
    this.logger = options.logger || SilentLogger;

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
  async logPayload(payload: IOpenAILogData, type: 'chat' | 'stream' = 'chat'): Promise<void> {
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
        payload: sanitizeOpenAILogData(payload),
      };

      // SEC-003: payload logs contain prompt/response content and `logDir` is
      // caller-supplied, so create them owner-only rather than under the process umask.
      await fs.promises.writeFile(filepath, JSON.stringify(logData, null, 2), {
        encoding: 'utf8',
        mode: OWNER_ONLY_FILE_MODE,
      });

      // Payload saved successfully (silent operation)
    } catch (error) {
      // Don't throw errors - just log them and continue
      // This ensures that API logging failures don't break the main functionality
      this.logger.error('[FilePayloadLogger] Failed to save payload log:', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Ensure log directory exists
   */
  private ensureLogDirectoryExists(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true, mode: OWNER_ONLY_DIR_MODE });
      }
    } catch (error) {
      this.logger.error('[FilePayloadLogger] Failed to create log directory:', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  // Sanitization intentionally lives in ./sanitize-openai-log-data.ts (SSOT utility).
}
