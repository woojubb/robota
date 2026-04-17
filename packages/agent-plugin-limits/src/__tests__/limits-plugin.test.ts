import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IPluginExecutionContext, IPluginExecutionResult } from '@robota-sdk/agent-core';
import { PluginError } from '@robota-sdk/agent-core';

// Mock logger before importing LimitsPlugin
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
  };
});

import { LimitsPlugin } from '../limits-plugin';
import type { ILimitsPluginOptions } from '../types';

/**
 * Helper to build a minimal IPluginExecutionContext for testing.
 */
function createContext(overrides: Partial<IPluginExecutionContext> = {}): IPluginExecutionContext {
  return {
    executionId: 'exec_1',
    sessionId: 'session_1',
    userId: 'user_1',
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content: 'hello',
        state: 'complete' as const,
        timestamp: new Date(),
      },
    ],
    config: { model: 'gpt-3.5-turbo' },
    ...overrides,
  };
}

/**
 * Helper to build a minimal IPluginExecutionResult for testing.
 */
function createResult(overrides: Partial<IPluginExecutionResult> = {}): IPluginExecutionResult {
  return {
    success: true,
    tokensUsed: 100,
    ...overrides,
  };
}

describe('LimitsPlugin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ----------------------------------------------------------------
  // Construction
  // ----------------------------------------------------------------
  describe('construction', () => {
    it('should construct with "none" strategy', () => {
      const plugin = new LimitsPlugin({ strategy: 'none' });
      expect(plugin.name).toBe('LimitsPlugin');
      expect(plugin.version).toBe('1.0.0');
    });

    it('should construct with "token-bucket" strategy', () => {
      const plugin = new LimitsPlugin({
        strategy: 'token-bucket',
        bucketSize: 5000,
        refillRate: 50,
      });
      expect(plugin.name).toBe('LimitsPlugin');
    });

    it('should construct with "sliding-window" strategy', () => {
      const plugin = new LimitsPlugin({
        strategy: 'sliding-window',
        timeWindow: 60000,
        maxTokens: 50000,
        maxRequests: 100,
      });
      expect(plugin.name).toBe('LimitsPlugin');
    });

    it('should construct with "fixed-window" strategy', () => {
      const plugin = new LimitsPlugin({
        strategy: 'fixed-window',
        timeWindow: 60000,
        maxTokens: 50000,
        maxRequests: 100,
      });
      expect(plugin.name).toBe('LimitsPlugin');
    });
  });

  // ----------------------------------------------------------------
  // Construction validation
  // ----------------------------------------------------------------
  describe('construction validation', () => {
    it('should throw when strategy is missing', () => {
      expect(() => new LimitsPlugin({ strategy: '' } as unknown as ILimitsPluginOptions)).toThrow(
        PluginError,
      );
      expect(() => new LimitsPlugin({ strategy: '' } as unknown as ILimitsPluginOptions)).toThrow(
        'Strategy must be specified',
      );
    });

    it('should throw when strategy is invalid', () => {
      expect(
        () => new LimitsPlugin({ strategy: 'invalid' } as unknown as ILimitsPluginOptions),
      ).toThrow(PluginError);
      expect(
        () => new LimitsPlugin({ strategy: 'invalid' } as unknown as ILimitsPluginOptions),
      ).toThrow('Invalid strategy');
    });

    it('should throw when bucketSize is negative for token-bucket', () => {
      expect(() => new LimitsPlugin({ strategy: 'token-bucket', bucketSize: -1 })).toThrow(
        'Bucket size must be positive',
      );
    });

    it('should throw when bucketSize is zero for token-bucket', () => {
      expect(() => new LimitsPlugin({ strategy: 'token-bucket', bucketSize: 0 })).toThrow(
        'Bucket size must be positive',
      );
    });

    it('should throw when refillRate is negative for token-bucket', () => {
      expect(() => new LimitsPlugin({ strategy: 'token-bucket', refillRate: -1 })).toThrow(
        'Refill rate must be non-negative',
      );
    });

    it('should throw when maxRequests is negative', () => {
      expect(() => new LimitsPlugin({ strategy: 'fixed-window', maxRequests: -1 })).toThrow(
        'Max requests must be non-negative',
      );
    });

    it('should throw when maxTokens is negative', () => {
      expect(() => new LimitsPlugin({ strategy: 'fixed-window', maxTokens: -1 })).toThrow(
        'Max tokens must be non-negative',
      );
    });

    it('should throw when maxCost is negative', () => {
      expect(() => new LimitsPlugin({ strategy: 'fixed-window', maxCost: -1 })).toThrow(
        'Max cost must be non-negative',
      );
    });

    it('should throw when tokenCostPer1000 is negative', () => {
      expect(() => new LimitsPlugin({ strategy: 'fixed-window', tokenCostPer1000: -1 })).toThrow(
        'Token cost per 1000 must be non-negative',
      );
    });

    it('should throw when timeWindow is non-positive for sliding-window', () => {
      expect(() => new LimitsPlugin({ strategy: 'sliding-window', timeWindow: 0 })).toThrow(
        'Time window must be positive',
      );
    });

    it('should throw when timeWindow is non-positive for fixed-window', () => {
      expect(() => new LimitsPlugin({ strategy: 'fixed-window', timeWindow: -100 })).toThrow(
        'Time window must be positive',
      );
    });
  });

  // ----------------------------------------------------------------
  // "none" strategy
  // ----------------------------------------------------------------
  describe('"none" strategy', () => {
    it('beforeExecution should be a no-op', async () => {
      const plugin = new LimitsPlugin({ strategy: 'none' });
      // Should not throw
      await plugin.beforeExecution(createContext());
    });

    it('afterExecution should be a no-op', async () => {
      const plugin = new LimitsPlugin({ strategy: 'none' });
      await plugin.afterExecution(createContext(), createResult());
    });
  });

  // ----------------------------------------------------------------
  // "fixed-window" strategy
  // ----------------------------------------------------------------
  describe('"fixed-window" strategy', () => {
    it('should allow requests within limits', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'fixed-window',
        maxTokens: 100000,
        maxRequests: 10,
        maxCost: 10,
        timeWindow: 60000,
      });

      await expect(plugin.beforeExecution(createContext())).resolves.toBeUndefined();
    });

    it('should throw PluginError when token limit is exceeded', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'fixed-window',
        maxTokens: 50, // Very low limit
        maxRequests: 1000,
        maxCost: 100,
        timeWindow: 60000,
      });

      // The first call estimates tokens from message content ("hello" = 5 chars / 4 ~ 2 + 100 buffer = 102)
      // which exceeds maxTokens of 50
      await expect(plugin.beforeExecution(createContext())).rejects.toThrow(PluginError);
      await expect(plugin.beforeExecution(createContext())).rejects.toThrow('Token limit exceeded');
    });

    it('should throw PluginError when request limit is exceeded', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'fixed-window',
        maxTokens: 1000000,
        maxRequests: 2,
        maxCost: 100,
        timeWindow: 60000,
      });

      // Use up the request limit
      await plugin.beforeExecution(createContext());
      await plugin.beforeExecution(createContext());

      await expect(plugin.beforeExecution(createContext())).rejects.toThrow(PluginError);
      await expect(plugin.beforeExecution(createContext())).rejects.toThrow(
        'Request limit exceeded',
      );
    });

    it('should throw PluginError when cost limit is exceeded', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'fixed-window',
        maxTokens: 1000000,
        maxRequests: 1000,
        maxCost: 0.0001, // Very low cost limit
        timeWindow: 60000,
      });

      await expect(plugin.beforeExecution(createContext())).rejects.toThrow(PluginError);
      await expect(plugin.beforeExecution(createContext())).rejects.toThrow('Cost limit exceeded');
    });

    it('should reset counters after window expires', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'fixed-window',
        maxTokens: 1000000,
        maxRequests: 2,
        maxCost: 100,
        timeWindow: 60000,
      });

      // Use up the request limit
      await plugin.beforeExecution(createContext());
      await plugin.beforeExecution(createContext());

      // Should be blocked
      await expect(plugin.beforeExecution(createContext())).rejects.toThrow(
        'Request limit exceeded',
      );

      // Advance time past the window
      vi.advanceTimersByTime(60001);

      // Should be allowed again after window reset
      await expect(plugin.beforeExecution(createContext())).resolves.toBeUndefined();
    });
  });

  // ----------------------------------------------------------------
  // "token-bucket" strategy
  // ----------------------------------------------------------------
  describe('"token-bucket" strategy', () => {
    it('should allow requests when tokens are available', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'token-bucket',
        bucketSize: 10000,
        refillRate: 100,
        maxRequests: 1000,
        maxCost: 100,
        timeWindow: 60000,
      });

      await expect(plugin.beforeExecution(createContext())).resolves.toBeUndefined();
    });

    it('should throw when bucket is depleted', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'token-bucket',
        bucketSize: 50, // Very small bucket (estimated tokens for "hello" is ~102)
        refillRate: 0, // No refill
        maxRequests: 1000,
        maxCost: 100,
        timeWindow: 60000,
      });

      await expect(plugin.beforeExecution(createContext())).rejects.toThrow(PluginError);
      await expect(plugin.beforeExecution(createContext())).rejects.toThrow(
        'Token bucket depleted',
      );
    });

    it('should refill tokens over time', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'token-bucket',
        bucketSize: 200,
        refillRate: 200, // 200 tokens per second
        maxRequests: 1000,
        maxCost: 100,
        timeWindow: 3600000,
      });

      // First call consumes tokens (~102 estimated)
      await plugin.beforeExecution(createContext());

      // Second call may deplete remaining tokens
      // Advance time to allow refill
      vi.advanceTimersByTime(2000); // 2 seconds => 400 tokens refilled, capped at bucketSize 200

      // Should succeed after refill
      await expect(plugin.beforeExecution(createContext())).resolves.toBeUndefined();
    });

    it('should throw when request limit is exceeded', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'token-bucket',
        bucketSize: 1000000,
        refillRate: 100000,
        maxRequests: 2,
        maxCost: 100,
        timeWindow: 60000,
      });

      await plugin.beforeExecution(createContext());
      await plugin.beforeExecution(createContext());

      await expect(plugin.beforeExecution(createContext())).rejects.toThrow(PluginError);
      await expect(plugin.beforeExecution(createContext())).rejects.toThrow(
        'Request limit exceeded',
      );
    });

    it('should throw when cost limit is exceeded', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'token-bucket',
        bucketSize: 1000000,
        refillRate: 100000,
        maxRequests: 1000,
        maxCost: 0.0001, // Very low cost limit
        timeWindow: 60000,
      });

      await expect(plugin.beforeExecution(createContext())).rejects.toThrow(PluginError);
      await expect(plugin.beforeExecution(createContext())).rejects.toThrow('Cost limit exceeded');
    });

    it('should reset request/cost counters after window expires', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'token-bucket',
        bucketSize: 1000000,
        refillRate: 100000,
        maxRequests: 2,
        maxCost: 100,
        timeWindow: 60000,
      });

      await plugin.beforeExecution(createContext());
      await plugin.beforeExecution(createContext());

      await expect(plugin.beforeExecution(createContext())).rejects.toThrow(
        'Request limit exceeded',
      );

      // Advance past window
      vi.advanceTimersByTime(60001);

      await expect(plugin.beforeExecution(createContext())).resolves.toBeUndefined();
    });
  });

  // ----------------------------------------------------------------
  // "sliding-window" strategy
  // ----------------------------------------------------------------
  describe('"sliding-window" strategy', () => {
    it('should allow requests within limits', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'sliding-window',
        maxTokens: 100000,
        maxRequests: 10,
        maxCost: 10,
        timeWindow: 60000,
      });

      await expect(plugin.beforeExecution(createContext())).resolves.toBeUndefined();
    });

    it('should throw when token limit is exceeded', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'sliding-window',
        maxTokens: 50, // Very low limit
        maxRequests: 1000,
        maxCost: 100,
        timeWindow: 60000,
      });

      await expect(plugin.beforeExecution(createContext())).rejects.toThrow(PluginError);
      await expect(plugin.beforeExecution(createContext())).rejects.toThrow('Token limit exceeded');
    });

    it('should throw when request limit is exceeded', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'sliding-window',
        maxTokens: 1000000,
        maxRequests: 2,
        maxCost: 100,
        timeWindow: 60000,
      });

      await plugin.beforeExecution(createContext());
      await plugin.beforeExecution(createContext());

      await expect(plugin.beforeExecution(createContext())).rejects.toThrow(PluginError);
      await expect(plugin.beforeExecution(createContext())).rejects.toThrow(
        'Request limit exceeded',
      );
    });

    it('should throw when cost limit is exceeded', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'sliding-window',
        maxTokens: 1000000,
        maxRequests: 1000,
        maxCost: 0.0001,
        timeWindow: 60000,
      });

      await expect(plugin.beforeExecution(createContext())).rejects.toThrow(PluginError);
      await expect(plugin.beforeExecution(createContext())).rejects.toThrow('Cost limit exceeded');
    });

    it('should reset counters after window expires', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'sliding-window',
        maxTokens: 1000000,
        maxRequests: 2,
        maxCost: 100,
        timeWindow: 60000,
      });

      await plugin.beforeExecution(createContext());
      await plugin.beforeExecution(createContext());

      await expect(plugin.beforeExecution(createContext())).rejects.toThrow(
        'Request limit exceeded',
      );

      // Advance past window
      vi.advanceTimersByTime(60001);

      await expect(plugin.beforeExecution(createContext())).resolves.toBeUndefined();
    });
  });

  // ----------------------------------------------------------------
  // getLimitsStatus
  // ----------------------------------------------------------------
  describe('getLimitsStatus', () => {
    it('should return summary status when no key is provided', () => {
      const plugin = new LimitsPlugin({ strategy: 'fixed-window' });
      const status = plugin.getLimitsStatus();

      expect(status).toHaveProperty('strategy', 'fixed-window');
      expect(status).toHaveProperty('totalKeys');
    });

    it('should return key-specific status with bucket data for token-bucket strategy', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'token-bucket',
        bucketSize: 10000,
        refillRate: 100,
        maxRequests: 1000,
        maxCost: 100,
        timeWindow: 60000,
      });

      const ctx = createContext({ userId: 'user_test' });
      await plugin.beforeExecution(ctx);

      const status = plugin.getLimitsStatus('user_test');
      expect(status).toHaveProperty('strategy', 'token-bucket');
      expect(status).toHaveProperty('key', 'user_test');
      expect(status).toHaveProperty('bucket');
      expect(status.bucket).not.toBeNull();
    });

    it('should return key-specific status with window data for fixed-window strategy', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'fixed-window',
        maxTokens: 100000,
        maxRequests: 1000,
        maxCost: 100,
        timeWindow: 60000,
      });

      const ctx = createContext({ userId: 'user_test' });
      await plugin.beforeExecution(ctx);

      const status = plugin.getLimitsStatus('user_test');
      expect(status).toHaveProperty('strategy', 'fixed-window');
      expect(status).toHaveProperty('key', 'user_test');
      expect(status).toHaveProperty('window');
      expect(status.window).not.toBeNull();
    });

    it('should return null bucket/window for unknown key', () => {
      const plugin = new LimitsPlugin({ strategy: 'fixed-window' });
      const status = plugin.getLimitsStatus('unknown_key');
      expect(status.bucket).toBeNull();
      expect(status.window).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // resetLimits
  // ----------------------------------------------------------------
  describe('resetLimits', () => {
    it('should reset a specific key', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'fixed-window',
        maxTokens: 100000,
        maxRequests: 1000,
        maxCost: 100,
        timeWindow: 60000,
      });

      const ctx = createContext({ userId: 'user_reset' });
      await plugin.beforeExecution(ctx);

      // Verify data exists
      const statusBefore = plugin.getLimitsStatus('user_reset');
      expect(statusBefore.window).not.toBeNull();

      // Reset
      plugin.resetLimits('user_reset');

      // Verify data cleared
      const statusAfter = plugin.getLimitsStatus('user_reset');
      expect(statusAfter.window).toBeNull();
    });

    it('should reset all keys when no key is provided', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'fixed-window',
        maxTokens: 100000,
        maxRequests: 1000,
        maxCost: 100,
        timeWindow: 60000,
      });

      await plugin.beforeExecution(createContext({ userId: 'user_a' }));
      await plugin.beforeExecution(createContext({ userId: 'user_b' }));

      // Both should have data
      const summaryBefore = plugin.getLimitsStatus();
      expect(summaryBefore.totalKeys).toBeGreaterThan(0);

      // Reset all
      plugin.resetLimits();

      const summaryAfter = plugin.getLimitsStatus();
      expect(summaryAfter.totalKeys).toBe(0);
    });
  });

  // ----------------------------------------------------------------
  // afterExecution
  // ----------------------------------------------------------------
  describe('afterExecution', () => {
    it('should update token and cost tracking for fixed-window', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'fixed-window',
        maxTokens: 100000,
        maxRequests: 1000,
        maxCost: 100,
        timeWindow: 60000,
      });

      const ctx = createContext({ userId: 'user_after' });
      await plugin.beforeExecution(ctx);
      await plugin.afterExecution(ctx, createResult({ tokensUsed: 500 }));

      const status = plugin.getLimitsStatus('user_after');
      expect(status.window).not.toBeNull();

      // Window tokens should reflect the tokensUsed from afterExecution
      const window = status.window as Record<string, string | number | boolean>;
      expect(window.tokens).toBe(500);
      expect(typeof window.cost).toBe('number');
      expect(window.cost as number).toBeGreaterThan(0);
    });

    it('should update cost tracking for token-bucket', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'token-bucket',
        bucketSize: 100000,
        refillRate: 100,
        maxRequests: 1000,
        maxCost: 100,
        timeWindow: 60000,
      });

      const ctx = createContext({ userId: 'user_bucket_after' });
      await plugin.beforeExecution(ctx);
      await plugin.afterExecution(ctx, createResult({ tokensUsed: 500 }));

      const status = plugin.getLimitsStatus('user_bucket_after');
      expect(status.bucket).not.toBeNull();

      const bucket = status.bucket as Record<string, string | number | boolean>;
      expect(typeof bucket.cost).toBe('number');
      expect(bucket.cost as number).toBeGreaterThan(0);
    });
  });

  // ----------------------------------------------------------------
  // Key derivation
  // ----------------------------------------------------------------
  describe('key derivation', () => {
    it('should use userId as key when present', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'fixed-window',
        maxTokens: 100000,
        maxRequests: 1000,
        maxCost: 100,
        timeWindow: 60000,
      });

      await plugin.beforeExecution(createContext({ userId: 'uid_1' }));

      const status = plugin.getLimitsStatus('uid_1');
      expect(status.window).not.toBeNull();
    });

    it('should fall back to sessionId when userId is absent', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'fixed-window',
        maxTokens: 100000,
        maxRequests: 1000,
        maxCost: 100,
        timeWindow: 60000,
      });

      await plugin.beforeExecution(createContext({ userId: undefined, sessionId: 'sid_1' }));

      const status = plugin.getLimitsStatus('sid_1');
      expect(status.window).not.toBeNull();
    });

    it('should fall back to executionId when userId and sessionId are absent', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'fixed-window',
        maxTokens: 100000,
        maxRequests: 1000,
        maxCost: 100,
        timeWindow: 60000,
      });

      await plugin.beforeExecution(
        createContext({ userId: undefined, sessionId: undefined, executionId: 'eid_1' }),
      );

      const status = plugin.getLimitsStatus('eid_1');
      expect(status.window).not.toBeNull();
    });

    it('should use "default" when no identifiers are present', async () => {
      const plugin = new LimitsPlugin({
        strategy: 'fixed-window',
        maxTokens: 100000,
        maxRequests: 1000,
        maxCost: 100,
        timeWindow: 60000,
      });

      await plugin.beforeExecution(
        createContext({ userId: undefined, sessionId: undefined, executionId: undefined }),
      );

      const status = plugin.getLimitsStatus('default');
      expect(status.window).not.toBeNull();
    });
  });
});
