import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConfigurationError, PluginError } from '@robota-sdk/agent-core';

// Mock logger before importing LoggingPlugin
vi.mock('@robota-sdk/agent-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-core')>();
  return {
    ...actual,
    createLogger: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      isDebugEnabled: vi.fn().mockReturnValue(false),
      setLevel: vi.fn(),
      getLevel: vi.fn().mockReturnValue('warn'),
    }),
    SilentLogger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

import { LoggingPlugin } from '../logging-plugin';
import type { ILogEntry, ILogStorage, ILogFormatter } from '../types';
import { EVENT_EMITTER_EVENTS } from '@robota-sdk/agent-core';
import type { IEventEmitterEventData } from '@robota-sdk/agent-core';

// Spy storage that records all writes
class SpyStorage implements ILogStorage {
  entries: ILogEntry[] = [];
  flushCount = 0;
  closeCount = 0;

  async write(entry: ILogEntry): Promise<void> {
    this.entries.push(entry);
  }

  async flush(): Promise<void> {
    this.flushCount++;
  }

  async close(): Promise<void> {
    this.closeCount++;
  }
}

// Failing storage that throws on write
class FailingStorage implements ILogStorage {
  async write(): Promise<void> {
    throw new Error('Storage write failed');
  }

  async flush(): Promise<void> {
    throw new Error('Storage flush failed');
  }

  async close(): Promise<void> {}
}

/**
 * Inject a spy storage into a LoggingPlugin instance.
 * Returns the spy so tests can inspect written entries.
 */
function injectSpyStorage(plugin: LoggingPlugin): SpyStorage {
  const spy = new SpyStorage();
  // Access private field for test injection — acceptable in test scope
  (plugin as unknown as { storage: ILogStorage }).storage = spy;
  return spy;
}

describe('LoggingPlugin', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ----------------------------------------------------------------
  // Construction and validation
  // ----------------------------------------------------------------
  describe('construction', () => {
    it('should create with silent strategy', () => {
      const plugin = new LoggingPlugin({ strategy: 'silent' });
      expect(plugin.name).toBe('LoggingPlugin');
      expect(plugin.version).toBe('1.0.0');
    });

    it('should create with console strategy', () => {
      const plugin = new LoggingPlugin({ strategy: 'console' });
      expect(plugin.name).toBe('LoggingPlugin');
    });

    it('should throw on missing strategy', () => {
      expect(() => new LoggingPlugin({ strategy: '' as 'silent' })).toThrow(ConfigurationError);
    });

    it('should throw on invalid strategy', () => {
      expect(() => new LoggingPlugin({ strategy: 'redis' as 'silent' })).toThrow(
        ConfigurationError,
      );
    });

    it('should throw on invalid log level', () => {
      expect(() => new LoggingPlugin({ strategy: 'silent', level: 'trace' as 'info' })).toThrow(
        ConfigurationError,
      );
    });

    it('should throw when file strategy has no filePath', () => {
      expect(() => new LoggingPlugin({ strategy: 'file', filePath: '' })).toThrow(
        ConfigurationError,
      );
    });

    it('should throw when remote strategy has no remoteEndpoint', () => {
      expect(() => new LoggingPlugin({ strategy: 'remote', remoteEndpoint: '' })).toThrow(
        ConfigurationError,
      );
    });

    it('should throw on non-positive maxLogs', () => {
      expect(() => new LoggingPlugin({ strategy: 'silent', maxLogs: 0 })).toThrow(
        ConfigurationError,
      );
    });

    it('should throw on non-positive batchSize', () => {
      expect(() => new LoggingPlugin({ strategy: 'silent', batchSize: -1 })).toThrow(
        ConfigurationError,
      );
    });

    it('should throw on non-positive flushInterval', () => {
      expect(() => new LoggingPlugin({ strategy: 'silent', flushInterval: 0 })).toThrow(
        ConfigurationError,
      );
    });
  });

  // ----------------------------------------------------------------
  // Log level filtering
  // ----------------------------------------------------------------
  describe('log level filtering', () => {
    it('should write entries at or above the configured level', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent', level: 'warn' });
      const spy = injectSpyStorage(plugin);

      await plugin.log('error', 'Error msg');
      await plugin.log('warn', 'Warn msg');

      expect(spy.entries).toHaveLength(2);
      expect(spy.entries[0].level).toBe('error');
      expect(spy.entries[1].level).toBe('warn');
    });

    it('should not write entries below the configured level', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent', level: 'error' });
      const spy = injectSpyStorage(plugin);

      await plugin.info('Info msg');
      await plugin.debug('Debug msg');
      await plugin.warn('Warn msg');

      expect(spy.entries).toHaveLength(0);
    });

    it('should write all levels when set to debug', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent', level: 'debug' });
      const spy = injectSpyStorage(plugin);

      await plugin.debug('d');
      await plugin.info('i');
      await plugin.warn('w');
      await plugin.error('e');

      expect(spy.entries).toHaveLength(4);
      expect(spy.entries.map((e) => e.level)).toEqual(['debug', 'info', 'warn', 'error']);
    });
  });

  // ----------------------------------------------------------------
  // Log entry structure
  // ----------------------------------------------------------------
  describe('log entry structure', () => {
    it('should write entry with timestamp, level, and message', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent', level: 'info' });
      const spy = injectSpyStorage(plugin);

      await plugin.info('Test message');

      expect(spy.entries).toHaveLength(1);
      const entry = spy.entries[0];
      expect(entry.level).toBe('info');
      expect(entry.message).toBe('Test message');
      expect(entry.timestamp).toBeInstanceOf(Date);
    });

    it('should include context when provided', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent', level: 'info' });
      const spy = injectSpyStorage(plugin);

      await plugin.info('With context', { operation: 'test', duration: 100 });

      const entry = spy.entries[0];
      expect(entry.context).toEqual({ operation: 'test', duration: 100 });
    });

    it('should include metadata when provided', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent', level: 'info' });
      const spy = injectSpyStorage(plugin);

      await plugin.log('info', 'With metadata', undefined, { executionId: 'exec-1' });

      const entry = spy.entries[0];
      expect(entry.metadata).toEqual({ executionId: 'exec-1' });
    });

    it('should include error details when includeStackTrace is true', async () => {
      const plugin = new LoggingPlugin({
        strategy: 'silent',
        level: 'error',
        includeStackTrace: true,
      });
      const spy = injectSpyStorage(plugin);

      const err = new Error('Stack trace test');
      await plugin.error('Error occurred', err);

      const entry = spy.entries[0];
      expect(entry.context?.errorMessage).toBe('Stack trace test');
      expect(entry.context?.errorStack).toBeDefined();
    });
  });

  // ----------------------------------------------------------------
  // Convenience methods
  // ----------------------------------------------------------------
  describe('convenience methods', () => {
    it('should log execution start with truncated user input', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent', level: 'info' });
      const spy = injectSpyStorage(plugin);

      const longInput = 'x'.repeat(200);
      await plugin.logExecutionStart('exec-1', longInput);

      expect(spy.entries).toHaveLength(1);
      const entry = spy.entries[0];
      expect(entry.message).toBe('Execution started');
      expect((entry.context?.userInput as string).length).toBeLessThanOrEqual(100);
      expect(entry.metadata?.executionId).toBe('exec-1');
      expect(entry.metadata?.operation).toBe('execution_start');
    });

    it('should log execution complete with duration', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent', level: 'info' });
      const spy = injectSpyStorage(plugin);

      await plugin.logExecutionComplete('exec-1', 150);

      const entry = spy.entries[0];
      expect(entry.message).toBe('Execution completed');
      expect(entry.context?.duration).toBe(150);
      expect(entry.metadata?.executionId).toBe('exec-1');
    });

    it('should log successful tool execution at info level', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent', level: 'info' });
      const spy = injectSpyStorage(plugin);

      await plugin.logToolExecution('search-tool', 'exec-1', 50, true);

      const entry = spy.entries[0];
      expect(entry.level).toBe('info');
      expect(entry.message).toBe('Tool executed successfully');
      expect(entry.context?.toolName).toBe('search-tool');
    });

    it('should log failed tool execution at error level', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent', level: 'info' });
      const spy = injectSpyStorage(plugin);

      await plugin.logToolExecution('search-tool', 'exec-1', 50, false);

      const entry = spy.entries[0];
      expect(entry.level).toBe('error');
      expect(entry.message).toBe('Tool execution failed');
    });
  });

  // ----------------------------------------------------------------
  // Formatter integration
  // ----------------------------------------------------------------
  describe('formatter', () => {
    it('should accept a custom formatter', () => {
      const formatter: ILogFormatter = {
        format(entry: ILogEntry): string {
          return `[${entry.level}] ${entry.message}`;
        },
      };

      const plugin = new LoggingPlugin({
        strategy: 'console',
        formatter,
      });

      expect(plugin.name).toBe('LoggingPlugin');
    });
  });

  // ----------------------------------------------------------------
  // Module event handling
  // ----------------------------------------------------------------
  describe('onModuleEvent', () => {
    function createEventData(
      overrides: Partial<IEventEmitterEventData> = {},
    ): IEventEmitterEventData {
      return {
        type: EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_START,
        timestamp: new Date(),
        executionId: 'exec-1',
        data: {
          moduleName: 'TestModule',
          moduleType: 'processor',
        },
        ...overrides,
      };
    }

    it('should write info entry for MODULE_INITIALIZE_START', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent', level: 'info' });
      const spy = injectSpyStorage(plugin);

      await plugin.onModuleEvent(EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_START, createEventData());

      expect(spy.entries).toHaveLength(1);
      expect(spy.entries[0].level).toBe('info');
      expect(spy.entries[0].message).toContain('initialization started');
      expect(spy.entries[0].context?.moduleName).toBe('TestModule');
    });

    it('should write info entry for MODULE_INITIALIZE_COMPLETE with duration', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent', level: 'info' });
      const spy = injectSpyStorage(plugin);

      await plugin.onModuleEvent(
        EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_COMPLETE,
        createEventData({
          type: EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_COMPLETE,
          data: { moduleName: 'TestModule', moduleType: 'processor', duration: 50 },
        }),
      );

      expect(spy.entries).toHaveLength(1);
      expect(spy.entries[0].message).toContain('initialization completed');
      expect(spy.entries[0].context?.duration).toBe(50);
    });

    it('should write error entry for MODULE_INITIALIZE_ERROR', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent', level: 'info' });
      const spy = injectSpyStorage(plugin);

      await plugin.onModuleEvent(
        EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_ERROR,
        createEventData({
          type: EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_ERROR,
          error: new Error('Init failed'),
        }),
      );

      expect(spy.entries).toHaveLength(1);
      expect(spy.entries[0].level).toBe('error');
      expect(spy.entries[0].message).toContain('initialization failed');
    });

    it('should write debug entry for MODULE_EXECUTION_START', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent', level: 'debug' });
      const spy = injectSpyStorage(plugin);

      await plugin.onModuleEvent(
        EVENT_EMITTER_EVENTS.MODULE_EXECUTION_START,
        createEventData({ type: EVENT_EMITTER_EVENTS.MODULE_EXECUTION_START }),
      );

      expect(spy.entries).toHaveLength(1);
      expect(spy.entries[0].level).toBe('debug');
      expect(spy.entries[0].message).toContain('execution started');
    });

    it('should write error entry for MODULE_EXECUTION_ERROR', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent', level: 'info' });
      const spy = injectSpyStorage(plugin);

      await plugin.onModuleEvent(
        EVENT_EMITTER_EVENTS.MODULE_EXECUTION_ERROR,
        createEventData({
          type: EVENT_EMITTER_EVENTS.MODULE_EXECUTION_ERROR,
          error: new Error('Execution failed'),
        }),
      );

      expect(spy.entries).toHaveLength(1);
      expect(spy.entries[0].level).toBe('error');
    });

    it('should use unknown for missing module data', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent', level: 'info' });
      const spy = injectSpyStorage(plugin);

      await plugin.onModuleEvent(EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_START, {
        type: EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_START,
        timestamp: new Date(),
      });

      expect(spy.entries).toHaveLength(1);
      expect(spy.entries[0].context?.moduleName).toBe('unknown');
    });
  });

  // ----------------------------------------------------------------
  // Flush and destroy
  // ----------------------------------------------------------------
  describe('flush and destroy', () => {
    it('should delegate flush to storage', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent' });
      const spy = injectSpyStorage(plugin);

      await plugin.flush();

      expect(spy.flushCount).toBe(1);
    });

    it('should delegate close to storage on destroy', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent' });
      const spy = injectSpyStorage(plugin);

      await plugin.destroy();

      expect(spy.closeCount).toBe(1);
    });
  });

  // ----------------------------------------------------------------
  // Error resilience
  // ----------------------------------------------------------------
  describe('error resilience', () => {
    it('should not throw when storage write fails', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent', level: 'info' });
      const failing = new FailingStorage();
      (plugin as unknown as { storage: ILogStorage }).storage = failing;

      await expect(plugin.info('This should not throw')).resolves.not.toThrow();
    });

    it('should throw PluginError when flush fails', async () => {
      const plugin = new LoggingPlugin({ strategy: 'silent' });
      const failing = new FailingStorage();
      (plugin as unknown as { storage: ILogStorage }).storage = failing;

      await expect(plugin.flush()).rejects.toThrow(PluginError);
    });
  });
});
