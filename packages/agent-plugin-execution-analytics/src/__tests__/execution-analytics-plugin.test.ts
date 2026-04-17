import { describe, it, expect } from 'vitest';
import { ExecutionAnalyticsPlugin } from '../execution-analytics-plugin';
import type { TUniversalMessage } from '@robota-sdk/agent-core';

function userMsg(content: string): TUniversalMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content,
    state: 'complete',
    timestamp: new Date(),
  };
}

function assistantMsg(content: string): TUniversalMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content,
    state: 'complete',
    timestamp: new Date(),
  };
}

describe('ExecutionAnalyticsPlugin', () => {
  describe('constructor', () => {
    it('initializes with default options', () => {
      const plugin = new ExecutionAnalyticsPlugin();
      expect(plugin.name).toBe('ExecutionAnalyticsPlugin');
      expect(plugin.version).toBe('1.0.0');
    });

    it('initializes with custom options', () => {
      const plugin = new ExecutionAnalyticsPlugin({
        maxEntries: 500,
        performanceThreshold: 2000,
        trackErrors: false,
      });
      expect(plugin.getPluginStats().totalRecorded).toBe(0);
    });
  });

  describe('run tracking', () => {
    it('tracks beforeRun and afterRun lifecycle', async () => {
      const plugin = new ExecutionAnalyticsPlugin();

      await plugin.beforeRun('hello world');
      expect(plugin.getActiveExecutions()).toHaveLength(1);
      expect(plugin.getActiveExecutions()[0].operation).toBe('run');

      await plugin.afterRun('hello world', 'response text');
      expect(plugin.getActiveExecutions()).toHaveLength(0);

      const stats = plugin.getExecutionStats('run');
      expect(stats).toHaveLength(1);
      expect(stats[0].success).toBe(true);
      expect(stats[0].operation).toBe('run');
      expect(stats[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('records metadata with input/output lengths', async () => {
      const plugin = new ExecutionAnalyticsPlugin();

      await plugin.beforeRun('input text');
      await plugin.afterRun('input text', 'output text');

      const stats = plugin.getExecutionStats('run');
      expect(stats[0].metadata?.inputLength).toBe(10);
      expect(stats[0].metadata?.responseLength).toBe(11);
    });
  });

  describe('provider call tracking', () => {
    it('tracks provider call lifecycle', async () => {
      const plugin = new ExecutionAnalyticsPlugin();
      const messages = [userMsg('what is 1+1?')];
      const response = assistantMsg('2');

      await plugin.beforeProviderCall(messages);
      expect(plugin.getActiveExecutions()).toHaveLength(1);

      await plugin.afterProviderCall(messages, response);
      expect(plugin.getActiveExecutions()).toHaveLength(0);

      const stats = plugin.getExecutionStats('provider-call');
      expect(stats).toHaveLength(1);
      expect(stats[0].success).toBe(true);
    });
  });

  describe('tool call tracking', () => {
    it('tracks tool call lifecycle', async () => {
      const plugin = new ExecutionAnalyticsPlugin();

      await plugin.beforeToolCall('calculator', { a: 1, b: 2 });
      await plugin.afterToolCall('calculator', { a: 1, b: 2 }, { success: true, result: '3' });

      const stats = plugin.getExecutionStats('tool-call');
      expect(stats).toHaveLength(1);
      expect(stats[0].success).toBe(true);
      expect(stats[0].metadata?.toolName).toBe('calculator');
    });

    it('tracks tool call with error', async () => {
      const plugin = new ExecutionAnalyticsPlugin({ trackErrors: true });

      await plugin.beforeToolCall('failing-tool', {});
      await plugin.afterToolCall('failing-tool', {}, { success: false, error: 'tool failed' });

      const stats = plugin.getExecutionStats('tool-call');
      expect(stats).toHaveLength(1);
      expect(stats[0].success).toBe(false);
      expect(stats[0].error?.type).toBe('ToolExecutionError');
    });
  });

  describe('error tracking', () => {
    it('records error for active execution', async () => {
      const plugin = new ExecutionAnalyticsPlugin();

      await plugin.beforeRun('test input');
      await plugin.onError(new Error('something went wrong'));

      const stats = plugin.getExecutionStats();
      expect(stats).toHaveLength(1);
      expect(stats[0].success).toBe(false);
      expect(stats[0].error?.message).toBe('something went wrong');
    });

    it('handles error when no active execution exists', async () => {
      const plugin = new ExecutionAnalyticsPlugin();
      await expect(plugin.onError(new Error('orphan error'))).resolves.not.toThrow();
    });
  });

  describe('getAggregatedStats', () => {
    it('returns empty stats when no executions recorded', () => {
      const plugin = new ExecutionAnalyticsPlugin();
      const aggregated = plugin.getAggregatedStats();

      expect(aggregated.totalExecutions).toBe(0);
      expect(aggregated.successRate).toBe(0);
      expect(aggregated.averageDuration).toBe(0);
    });

    it('aggregates across multiple operations', async () => {
      const plugin = new ExecutionAnalyticsPlugin();

      await plugin.beforeRun('input1');
      await plugin.afterRun('input1', 'output1');

      await plugin.beforeRun('input2');
      await plugin.afterRun('input2', 'output2');

      await plugin.beforeToolCall('tool1', {});
      await plugin.afterToolCall('tool1', {}, { success: false, error: 'fail' });

      const aggregated = plugin.getAggregatedStats();
      expect(aggregated.totalExecutions).toBe(3);
      expect(aggregated.successfulExecutions).toBe(2);
      expect(aggregated.failedExecutions).toBe(1);
      expect(aggregated.operationStats['run']?.count).toBe(2);
      expect(aggregated.operationStats['tool-call']?.count).toBe(1);
    });
  });

  describe('max entries rotation', () => {
    it('maintains max entries limit by removing oldest', async () => {
      const plugin = new ExecutionAnalyticsPlugin({ maxEntries: 3 });

      for (let i = 0; i < 5; i++) {
        await plugin.beforeRun(`input-${i}`);
        await plugin.afterRun(`input-${i}`, `output-${i}`);
      }

      const stats = plugin.getExecutionStats();
      expect(stats).toHaveLength(3);
    });
  });

  describe('clearStats', () => {
    it('clears all execution data', async () => {
      const plugin = new ExecutionAnalyticsPlugin();

      await plugin.beforeRun('input');
      await plugin.afterRun('input', 'output');

      plugin.clearStats();

      expect(plugin.getExecutionStats()).toHaveLength(0);
      expect(plugin.getActiveExecutions()).toHaveLength(0);
      expect(plugin.getPluginStats().totalRecorded).toBe(0);
    });
  });

  describe('getPluginStats', () => {
    it('reports memory usage and record count', async () => {
      const plugin = new ExecutionAnalyticsPlugin();

      await plugin.beforeRun('test');
      await plugin.afterRun('test', 'response');

      const pluginStats = plugin.getPluginStats();
      expect(pluginStats.totalRecorded).toBe(1);
      expect(pluginStats.activeExecutions).toBe(0);
      expect(pluginStats.oldestRecord).toBeDefined();
      expect(pluginStats.newestRecord).toBeDefined();
    });
  });

  describe('destroy', () => {
    it('clears all data on destroy', async () => {
      const plugin = new ExecutionAnalyticsPlugin();

      await plugin.beforeRun('test');
      await plugin.afterRun('test', 'response');

      await plugin.destroy();

      expect(plugin.getExecutionStats()).toHaveLength(0);
    });
  });
});
