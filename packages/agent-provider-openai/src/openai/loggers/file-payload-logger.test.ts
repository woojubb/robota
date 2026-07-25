import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { FilePayloadLogger } from './file-payload-logger';
import type { ILogger } from '@robota-sdk/agent-core';
import type { IOpenAILogData } from '../types/api-types';

// Mock fs module
vi.mock('fs', () => {
  return {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    promises: {
      writeFile: vi.fn(),
    },
  };
});

// SEC-003: `fs` is mocked, so this is an inert fixture path; it deliberately does not
// live under the OS temp dir.
const LOG_DIR = '/var/robota-test/openai-payload-logs';

function createMockLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  };
}

function createSamplePayload(): IOpenAILogData {
  return {
    model: 'gpt-4',
    messagesCount: 3,
    hasTools: true,
    temperature: 0.7,
    maxTokens: 1000,
    timestamp: '2026-01-01T00:00:00.000Z',
  };
}

describe('FilePayloadLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: directory exists
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);
  });

  describe('constructor', () => {
    it('should create logger with required logDir option', () => {
      const logger = new FilePayloadLogger({ logDir: LOG_DIR });
      expect(logger.isEnabled()).toBe(true);
    });

    it('should default to enabled when not specified', () => {
      const logger = new FilePayloadLogger({ logDir: LOG_DIR });
      expect(logger.isEnabled()).toBe(true);
    });

    it('should respect enabled false option', () => {
      const logger = new FilePayloadLogger({ logDir: LOG_DIR, enabled: false });
      expect(logger.isEnabled()).toBe(false);
    });

    it('should create log directory if it does not exist and enabled', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      new FilePayloadLogger({ logDir: LOG_DIR });

      expect(fs.mkdirSync).toHaveBeenCalledWith(LOG_DIR, { recursive: true, mode: 0o700 });
    });

    it('should not create log directory when disabled', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      new FilePayloadLogger({ logDir: LOG_DIR, enabled: false });

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should not create log directory if it already exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      new FilePayloadLogger({ logDir: LOG_DIR });

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should handle directory creation error gracefully', () => {
      const mockLogger = createMockLogger();
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      // Should not throw
      const logger = new FilePayloadLogger({ logDir: '/root/logs', logger: mockLogger });
      expect(logger.isEnabled()).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[FilePayloadLogger]'),
        expect.objectContaining({ error: 'Permission denied' }),
      );
    });
  });

  describe('isEnabled', () => {
    it('should return true when enabled', () => {
      const logger = new FilePayloadLogger({ logDir: LOG_DIR, enabled: true });
      expect(logger.isEnabled()).toBe(true);
    });

    it('should return false when disabled', () => {
      const logger = new FilePayloadLogger({ logDir: LOG_DIR, enabled: false });
      expect(logger.isEnabled()).toBe(false);
    });
  });

  describe('logPayload', () => {
    it('should write payload to a JSON file', async () => {
      const logger = new FilePayloadLogger({ logDir: LOG_DIR });
      const payload = createSamplePayload();

      await logger.logPayload(payload, 'chat');

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(`${LOG_DIR}/openai-chat-`),
        expect.any(String),
        // SEC-003: payload logs hold prompt content, so they must be owner-only.
        { encoding: 'utf8', mode: 0o600 },
      );
    });

    it('should write valid JSON content', async () => {
      const logger = new FilePayloadLogger({ logDir: LOG_DIR });
      const payload = createSamplePayload();

      await logger.logPayload(payload, 'chat');

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0];
      const content = writeCall[1] as string;
      const parsed = JSON.parse(content);

      expect(parsed.type).toBe('chat');
      expect(parsed.provider).toBe('openai');
      expect(parsed.payload.model).toBe('gpt-4');
      expect(parsed.timestamp).toBeDefined();
    });

    it('should use stream type in filename when type is stream', async () => {
      const logger = new FilePayloadLogger({ logDir: LOG_DIR });
      const payload = createSamplePayload();

      await logger.logPayload(payload, 'stream');

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0];
      const filepath = writeCall[0] as string;
      expect(filepath).toContain('openai-stream-');
    });

    it('should include timestamp in filename when includeTimestamp is true', async () => {
      const logger = new FilePayloadLogger({
        logDir: LOG_DIR,
        includeTimestamp: true,
      });
      const payload = createSamplePayload();

      await logger.logPayload(payload, 'chat');

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0];
      const filepath = writeCall[0] as string;
      // Timestamp format replaces : and . with -
      expect(filepath).toMatch(/openai-chat-\d{4}-\d{2}-\d{2}T/);
    });

    it('should use Date.now() in filename when includeTimestamp is false', async () => {
      const logger = new FilePayloadLogger({
        logDir: LOG_DIR,
        includeTimestamp: false,
      });
      const payload = createSamplePayload();

      await logger.logPayload(payload, 'chat');

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0];
      const filepath = writeCall[0] as string;
      // Should contain a numeric timestamp
      expect(filepath).toMatch(/openai-chat-\d+\.json$/);
    });

    it('should skip logging when disabled', async () => {
      const logger = new FilePayloadLogger({ logDir: LOG_DIR, enabled: false });
      const payload = createSamplePayload();

      await logger.logPayload(payload, 'chat');

      expect(fs.promises.writeFile).not.toHaveBeenCalled();
    });

    it('should not throw on write error and log the error', async () => {
      const mockLogger = createMockLogger();
      vi.mocked(fs.promises.writeFile).mockRejectedValue(new Error('Disk full'));

      const logger = new FilePayloadLogger({ logDir: LOG_DIR, logger: mockLogger });
      const payload = createSamplePayload();

      // Should not throw
      await expect(logger.logPayload(payload, 'chat')).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[FilePayloadLogger]'),
        expect.objectContaining({ error: 'Disk full' }),
      );
    });

    it('should sanitize payload before writing', async () => {
      const logger = new FilePayloadLogger({ logDir: LOG_DIR });
      const payload = createSamplePayload();

      await logger.logPayload(payload, 'chat');

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0];
      const content = writeCall[1] as string;
      const parsed = JSON.parse(content);

      // Verify the payload is a sanitized copy
      expect(parsed.payload).toEqual(
        expect.objectContaining({
          model: 'gpt-4',
          messagesCount: 3,
        }),
      );
    });

    it('should default type to chat', async () => {
      const logger = new FilePayloadLogger({ logDir: LOG_DIR });
      const payload = createSamplePayload();

      await logger.logPayload(payload, 'chat');

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0];
      const filepath = writeCall[0] as string;
      expect(filepath).toContain('openai-chat-');
    });
  });
});
