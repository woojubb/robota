import { describe, it, expect, vi } from 'vitest';
import { ConsolePayloadLogger } from './console-payload-logger';
import type { ILogger } from '@robota-sdk/agent-core';
import type { IOpenAILogData } from '../types/api-types';

function createMockLogger(): ILogger & {
  group: ReturnType<typeof vi.fn>;
  groupEnd: ReturnType<typeof vi.fn>;
} {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
    group: vi.fn(),
    groupEnd: vi.fn(),
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

describe('ConsolePayloadLogger', () => {
  describe('constructor', () => {
    it('should default to enabled', () => {
      const logger = new ConsolePayloadLogger();
      expect(logger.isEnabled()).toBe(true);
    });

    it('should respect enabled option set to false', () => {
      const logger = new ConsolePayloadLogger({ enabled: false });
      expect(logger.isEnabled()).toBe(false);
    });

    it('should accept custom logger', () => {
      const mockLogger = createMockLogger();
      const logger = new ConsolePayloadLogger({ logger: mockLogger });
      expect(logger.isEnabled()).toBe(true);
    });
  });

  describe('isEnabled', () => {
    it('should return true when enabled', () => {
      const logger = new ConsolePayloadLogger({ enabled: true });
      expect(logger.isEnabled()).toBe(true);
    });

    it('should return false when disabled', () => {
      const logger = new ConsolePayloadLogger({ enabled: false });
      expect(logger.isEnabled()).toBe(false);
    });
  });

  describe('logPayload', () => {
    it('should log payload to console with chat type', async () => {
      const mockLogger = createMockLogger();
      const logger = new ConsolePayloadLogger({ logger: mockLogger });
      const payload = createSamplePayload();

      await logger.logPayload(payload, 'chat');

      expect(mockLogger.group).toHaveBeenCalledWith(expect.stringContaining('[OpenAI CHAT]'));
      expect(mockLogger.info).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalled();
      expect(mockLogger.groupEnd).toHaveBeenCalled();
    });

    it('should log payload with stream type', async () => {
      const mockLogger = createMockLogger();
      const logger = new ConsolePayloadLogger({ logger: mockLogger });
      const payload = createSamplePayload();

      await logger.logPayload(payload, 'stream');

      expect(mockLogger.group).toHaveBeenCalledWith(expect.stringContaining('[OpenAI STREAM]'));
    });

    it('should include timestamp in group title when includeTimestamp is true', async () => {
      const mockLogger = createMockLogger();
      const logger = new ConsolePayloadLogger({
        logger: mockLogger,
        includeTimestamp: true,
      });
      const payload = createSamplePayload();

      await logger.logPayload(payload, 'chat');

      expect(mockLogger.group).toHaveBeenCalledWith(expect.stringContaining(payload.timestamp));
    });

    it('should not include timestamp when includeTimestamp is false', async () => {
      const mockLogger = createMockLogger();
      const logger = new ConsolePayloadLogger({
        logger: mockLogger,
        includeTimestamp: false,
      });
      const payload = createSamplePayload();

      await logger.logPayload(payload, 'chat');

      const groupCall = mockLogger.group.mock.calls[0][0] as string;
      expect(groupCall).not.toContain(payload.timestamp);
    });

    it('should skip logging when disabled', async () => {
      const mockLogger = createMockLogger();
      const logger = new ConsolePayloadLogger({
        logger: mockLogger,
        enabled: false,
      });
      const payload = createSamplePayload();

      await logger.logPayload(payload, 'chat');

      expect(mockLogger.group).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });

    it('should not throw on internal error and log the error', async () => {
      const mockLogger = createMockLogger();
      // Make group throw an error
      mockLogger.group.mockImplementation(() => {
        throw new Error('Console error');
      });
      const logger = new ConsolePayloadLogger({ logger: mockLogger });
      const payload = createSamplePayload();

      // Should not throw
      await expect(logger.logPayload(payload, 'chat')).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[ConsolePayloadLogger]'),
        expect.any(String),
      );
    });

    it('should log request details with payload fields', async () => {
      const mockLogger = createMockLogger();
      const logger = new ConsolePayloadLogger({ logger: mockLogger });
      const payload = createSamplePayload();

      await logger.logPayload(payload, 'chat');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          model: 'gpt-4',
          messagesCount: 3,
          hasTools: true,
        }),
      );
    });

    it('should default type to chat', async () => {
      const mockLogger = createMockLogger();
      const logger = new ConsolePayloadLogger({ logger: mockLogger });
      const payload = createSamplePayload();

      await logger.logPayload(payload, 'chat');

      expect(mockLogger.group).toHaveBeenCalledWith(expect.stringContaining('CHAT'));
    });
  });
});
