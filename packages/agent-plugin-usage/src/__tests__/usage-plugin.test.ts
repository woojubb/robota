import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UsagePlugin } from '../usage-plugin';
import { ConfigurationError, PluginError } from '@robota-sdk/agent-core';

describe('UsagePlugin', () => {
  let plugin: UsagePlugin;

  afterEach(async () => {
    if (plugin) {
      await plugin.destroy();
    }
  });

  describe('constructor', () => {
    it('creates plugin with memory strategy', () => {
      plugin = new UsagePlugin({ strategy: 'memory' });
      expect(plugin.name).toBe('UsagePlugin');
      expect(plugin.version).toBe('1.0.0');
    });

    it('creates plugin with silent strategy', () => {
      plugin = new UsagePlugin({ strategy: 'silent' });
      expect(plugin.name).toBe('UsagePlugin');
    });

    it('throws ConfigurationError for missing strategy', () => {
      expect(() => new UsagePlugin({ strategy: '' as any })).toThrow(ConfigurationError);
    });

    it('throws ConfigurationError for invalid strategy', () => {
      expect(() => new UsagePlugin({ strategy: 'invalid' as any })).toThrow(ConfigurationError);
    });

    it('throws ConfigurationError for file strategy without filePath', () => {
      expect(() => new UsagePlugin({ strategy: 'file' })).toThrow(ConfigurationError);
    });

    it('throws ConfigurationError for remote strategy without endpoint', () => {
      expect(() => new UsagePlugin({ strategy: 'remote' })).toThrow(ConfigurationError);
    });

    it('throws ConfigurationError for non-positive maxEntries', () => {
      expect(() => new UsagePlugin({ strategy: 'memory', maxEntries: 0 })).toThrow(
        ConfigurationError,
      );
    });

    it('throws ConfigurationError for non-positive batchSize', () => {
      expect(() => new UsagePlugin({ strategy: 'memory', batchSize: -1 })).toThrow(
        ConfigurationError,
      );
    });

    it('throws ConfigurationError for non-positive flushInterval', () => {
      expect(() => new UsagePlugin({ strategy: 'memory', flushInterval: 0 })).toThrow(
        ConfigurationError,
      );
    });

    it('throws ConfigurationError for non-positive aggregationInterval', () => {
      expect(() => new UsagePlugin({ strategy: 'memory', aggregationInterval: -5 })).toThrow(
        ConfigurationError,
      );
    });
  });

  describe('recordUsage', () => {
    beforeEach(() => {
      plugin = new UsagePlugin({ strategy: 'memory', aggregateStats: false });
    });

    it('records a usage entry', async () => {
      await plugin.recordUsage({
        provider: 'openai',
        model: 'gpt-4',
        tokensUsed: { input: 100, output: 50, total: 150 },
        requestCount: 1,
        duration: 500,
        success: true,
      });
      const stats = await plugin.getUsageStats();
      expect(stats).toHaveLength(1);
      expect(stats[0].provider).toBe('openai');
      expect(stats[0].model).toBe('gpt-4');
      expect(stats[0].tokensUsed.total).toBe(150);
    });

    it('calculates cost when trackCosts is enabled', async () => {
      plugin = new UsagePlugin({
        strategy: 'memory',
        trackCosts: true,
        costRates: { 'gpt-4': { input: 0.03, output: 0.06 } },
        aggregateStats: false,
      });

      await plugin.recordUsage({
        provider: 'openai',
        model: 'gpt-4',
        tokensUsed: { input: 100, output: 50, total: 150 },
        requestCount: 1,
        duration: 500,
        success: true,
      });

      const stats = await plugin.getUsageStats();
      expect(stats[0].cost).toBeDefined();
      expect(stats[0].cost!.input).toBe(3);
      expect(stats[0].cost!.output).toBe(3);
      expect(stats[0].cost!.total).toBe(6);
    });

    it('does not calculate cost when no rate exists for model', async () => {
      plugin = new UsagePlugin({
        strategy: 'memory',
        trackCosts: true,
        costRates: { 'gpt-4': { input: 0.03, output: 0.06 } },
        aggregateStats: false,
      });

      await plugin.recordUsage({
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        tokensUsed: { input: 100, output: 50, total: 150 },
        requestCount: 1,
        duration: 300,
        success: true,
      });

      const stats = await plugin.getUsageStats();
      expect(stats[0].cost).toBeUndefined();
    });
  });

  describe('getUsageStats', () => {
    beforeEach(async () => {
      plugin = new UsagePlugin({ strategy: 'memory', aggregateStats: false });
      await plugin.recordUsage({
        provider: 'openai',
        model: 'gpt-4',
        tokensUsed: { input: 100, output: 50, total: 150 },
        requestCount: 1,
        duration: 500,
        success: true,
        conversationId: 'conv-1',
      });
      await plugin.recordUsage({
        provider: 'anthropic',
        model: 'claude-3',
        tokensUsed: { input: 200, output: 100, total: 300 },
        requestCount: 1,
        duration: 800,
        success: false,
        conversationId: 'conv-2',
      });
    });

    it('returns all stats when no filter', async () => {
      const stats = await plugin.getUsageStats();
      expect(stats).toHaveLength(2);
    });

    it('filters by conversationId', async () => {
      const stats = await plugin.getUsageStats('conv-1');
      expect(stats).toHaveLength(1);
      expect(stats[0].provider).toBe('openai');
    });
  });

  describe('getAggregatedStats', () => {
    beforeEach(async () => {
      plugin = new UsagePlugin({ strategy: 'memory', aggregateStats: false });
      await plugin.recordUsage({
        provider: 'openai',
        model: 'gpt-4',
        tokensUsed: { input: 100, output: 50, total: 150 },
        requestCount: 1,
        duration: 500,
        success: true,
      });
      await plugin.recordUsage({
        provider: 'openai',
        model: 'gpt-4',
        tokensUsed: { input: 200, output: 100, total: 300 },
        requestCount: 1,
        duration: 800,
        success: false,
      });
    });

    it('aggregates correctly', async () => {
      const aggregated = await plugin.getAggregatedStats();
      expect(aggregated.totalRequests).toBe(2);
      expect(aggregated.totalTokens).toBe(450);
      expect(aggregated.successRate).toBe(0.5);
    });
  });

  describe('clearStats', () => {
    it('clears all usage statistics', async () => {
      plugin = new UsagePlugin({ strategy: 'memory', aggregateStats: false });
      await plugin.recordUsage({
        provider: 'openai',
        model: 'gpt-4',
        tokensUsed: { input: 100, output: 50, total: 150 },
        requestCount: 1,
        duration: 500,
        success: true,
      });
      await plugin.clearStats();
      const stats = await plugin.getUsageStats();
      expect(stats).toHaveLength(0);
    });
  });

  describe('flush', () => {
    it('flushes without error for memory strategy', async () => {
      plugin = new UsagePlugin({ strategy: 'memory', aggregateStats: false });
      await expect(plugin.flush()).resolves.toBeUndefined();
    });
  });

  describe('destroy', () => {
    it('destroys the plugin without error', async () => {
      plugin = new UsagePlugin({ strategy: 'memory', aggregateStats: false });
      await expect(plugin.destroy()).resolves.toBeUndefined();
    });
  });

  describe('silent strategy', () => {
    beforeEach(() => {
      plugin = new UsagePlugin({ strategy: 'silent', aggregateStats: false });
    });

    it('records and returns empty stats', async () => {
      await plugin.recordUsage({
        provider: 'openai',
        model: 'gpt-4',
        tokensUsed: { input: 100, output: 50, total: 150 },
        requestCount: 1,
        duration: 500,
        success: true,
      });
      const stats = await plugin.getUsageStats();
      expect(stats).toHaveLength(0);
    });
  });

  describe('file strategy', () => {
    it('creates plugin with file strategy and valid filePath', () => {
      plugin = new UsagePlugin({
        strategy: 'file',
        filePath: './usage.json',
        aggregateStats: false,
      });
      expect(plugin.name).toBe('UsagePlugin');
    });

    it('records usage with file strategy', async () => {
      plugin = new UsagePlugin({
        strategy: 'file',
        filePath: './usage.json',
        aggregateStats: false,
      });
      await expect(
        plugin.recordUsage({
          provider: 'openai',
          model: 'gpt-4',
          tokensUsed: { input: 100, output: 50, total: 150 },
          requestCount: 1,
          duration: 500,
          success: true,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('remote strategy', () => {
    it('creates plugin with remote strategy and valid endpoint', () => {
      plugin = new UsagePlugin({
        strategy: 'remote',
        remoteEndpoint: 'https://api.example.com/usage',
        aggregateStats: false,
      });
      expect(plugin.name).toBe('UsagePlugin');
    });
  });

  describe('aggregateStats: true', () => {
    it('creates plugin with aggregation enabled and runs timer callback', async () => {
      plugin = new UsagePlugin({
        strategy: 'memory',
        aggregateStats: true,
        aggregationInterval: 50,
      });
      expect(plugin).toBeDefined();
      // allow timer to fire at least once
      await new Promise((r) => setTimeout(r, 80));
    });
  });

  describe('onModuleEvent', () => {
    beforeEach(() => {
      plugin = new UsagePlugin({ strategy: 'memory', aggregateStats: false });
    });

    it('records module success event', async () => {
      await plugin.onModuleEvent('module.execution.complete', {
        type: 'module.execution.complete',
        timestamp: new Date(),
        executionId: 'eid',
        sessionId: 'sid',
        data: { duration: 100, moduleName: 'testModule', moduleType: 'executor' },
      });
      const stats = await plugin.getUsageStats();
      expect(stats).toHaveLength(1);
      expect(stats[0].provider).toBe('module');
      expect(stats[0].success).toBe(true);
    });

    it('records module error event', async () => {
      await plugin.onModuleEvent('module.execution.error', {
        type: 'module.execution.error',
        timestamp: new Date(),
        executionId: 'eid',
        sessionId: 'sid',
        error: new Error('test error'),
        data: { duration: 50, moduleName: 'testModule', moduleType: 'executor' },
      });
      const stats = await plugin.getUsageStats();
      expect(stats).toHaveLength(1);
      expect(stats[0].success).toBe(false);
    });

    it('ignores non-module events', async () => {
      await plugin.onModuleEvent('conversation.start', {
        type: 'conversation.start',
        timestamp: new Date(),
        executionId: 'eid',
        sessionId: 'sid',
        data: {},
      });
      const stats = await plugin.getUsageStats();
      expect(stats).toHaveLength(0);
    });

    it('ignores events with no duration', async () => {
      await plugin.onModuleEvent('module.execution.complete', {
        type: 'module.execution.complete',
        timestamp: new Date(),
        executionId: 'eid',
        sessionId: 'sid',
        data: { moduleName: 'testModule' },
      });
      const stats = await plugin.getUsageStats();
      expect(stats).toHaveLength(0);
    });
  });
});
