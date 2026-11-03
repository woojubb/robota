import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PerformancePlugin } from '../performance-plugin';
import type { ISystemMetricsCollector } from '../types';
import { ConfigurationError } from '@robota-sdk/agent-core';

const collector: ISystemMetricsCollector = {
  getMemoryUsage: async () => ({
    used: 1,
    free: 2,
    total: 3,
    heap: { used: 4, total: 5 },
  }),
  getCPUUsage: async () => ({ user: 6, system: 7, percent: 8 }),
  getNetworkStats: async () => undefined,
};

describe('PerformancePlugin', () => {
  let plugin: PerformancePlugin;

  afterEach(async () => {
    if (plugin) {
      await plugin.dispose();
    }
  });

  describe('constructor', () => {
    it('creates plugin with memory strategy', () => {
      plugin = new PerformancePlugin({ strategy: 'memory', metricsCollector: collector });
      expect(plugin.name).toBe('PerformancePlugin');
      expect(plugin.version).toBe('1.0.0');
    });

    it('creates plugin without a collector when no system monitoring is on', () => {
      plugin = new PerformancePlugin({
        strategy: 'memory',
        monitorMemory: false,
        monitorCPU: false,
      });
      expect(plugin.name).toBe('PerformancePlugin');
    });

    it('monitors no system metrics by default when no collector is injected', () => {
      plugin = new PerformancePlugin({ strategy: 'memory' });
      expect(plugin.name).toBe('PerformancePlugin');
    });

    it.each([
      { name: 'with only monitorMemory on', options: { monitorMemory: true, monitorCPU: false } },
      { name: 'with only monitorCPU on', options: { monitorMemory: false, monitorCPU: true } },
      {
        name: 'with only monitorNetwork on',
        options: { monitorMemory: false, monitorCPU: false, monitorNetwork: true },
      },
    ])('throws ConfigurationError without a metricsCollector $name', ({ options }) => {
      expect(() => new PerformancePlugin({ strategy: 'memory', ...options })).toThrow(
        ConfigurationError,
      );
    });

    it('throws ConfigurationError for missing strategy', () => {
      expect(() => new PerformancePlugin({ strategy: '' as any })).toThrow(ConfigurationError);
    });

    it('throws ConfigurationError for invalid strategy', () => {
      expect(() => new PerformancePlugin({ strategy: 'invalid' as any })).toThrow(
        ConfigurationError,
      );
    });

    it('throws ConfigurationError for unimplemented strategy', () => {
      // file, prometheus, remote, silent are valid but not implemented
      expect(
        () => new PerformancePlugin({ strategy: 'file', monitorMemory: false, monitorCPU: false }),
      ).toThrow(ConfigurationError);
    });
  });

  describe('recordMetrics', () => {
    beforeEach(() => {
      plugin = new PerformancePlugin({
        strategy: 'memory',
        monitorMemory: false,
        monitorCPU: false,
      });
    });

    it('records a metric entry', async () => {
      await plugin.recordMetrics({
        operation: 'test-op',
        duration: 100,
        success: true,
        errorCount: 0,
      });
      const metrics = await plugin.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].operation).toBe('test-op');
      expect(metrics[0].duration).toBe(100);
    });

    it('records with system metrics when monitoring enabled', async () => {
      plugin = new PerformancePlugin({
        strategy: 'memory',
        metricsCollector: collector,
        monitorMemory: true,
        monitorCPU: true,
        monitorNetwork: true,
      });
      await plugin.recordMetrics({
        operation: 'test-op',
        duration: 50,
        success: true,
        errorCount: 0,
      });
      const metrics = await plugin.getMetrics();
      expect(metrics).toHaveLength(1);
      // Memory and CPU come from the injected collector; this one reports no network figures
      expect(metrics[0].memoryUsage?.heap.used).toBe(4);
      expect(metrics[0].cpuUsage?.user).toBe(6);
      expect(metrics[0].networkStats).toBeUndefined();
    });
  });

  describe('getMetrics', () => {
    beforeEach(async () => {
      plugin = new PerformancePlugin({
        strategy: 'memory',
        monitorMemory: false,
        monitorCPU: false,
      });
      await plugin.recordMetrics({
        operation: 'op-a',
        duration: 100,
        success: true,
        errorCount: 0,
      });
      await plugin.recordMetrics({
        operation: 'op-b',
        duration: 200,
        success: false,
        errorCount: 1,
      });
    });

    it('returns all metrics with no filter', async () => {
      const metrics = await plugin.getMetrics();
      expect(metrics).toHaveLength(2);
    });

    it('filters by operation', async () => {
      const metrics = await plugin.getMetrics('op-a');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].operation).toBe('op-a');
    });
  });

  describe('getAggregatedStats', () => {
    beforeEach(async () => {
      plugin = new PerformancePlugin({
        strategy: 'memory',
        monitorMemory: false,
        monitorCPU: false,
      });
      await plugin.recordMetrics({ operation: 'op', duration: 100, success: true, errorCount: 0 });
      await plugin.recordMetrics({ operation: 'op', duration: 300, success: false, errorCount: 2 });
    });

    it('aggregates correctly', async () => {
      const stats = await plugin.getAggregatedStats();
      expect(stats.totalOperations).toBe(2);
      expect(stats.averageDuration).toBe(200);
      expect(stats.minDuration).toBe(100);
      expect(stats.maxDuration).toBe(300);
      expect(stats.successRate).toBe(0.5);
    });

    it('returns zeroed stats for empty data', async () => {
      await plugin.clearMetrics();
      const stats = await plugin.getAggregatedStats();
      expect(stats.totalOperations).toBe(0);
      expect(stats.averageDuration).toBe(0);
    });
  });

  describe('clearMetrics', () => {
    it('clears all metrics', async () => {
      plugin = new PerformancePlugin({
        strategy: 'memory',
        monitorMemory: false,
        monitorCPU: false,
      });
      await plugin.recordMetrics({ operation: 'op', duration: 100, success: true, errorCount: 0 });
      await plugin.clearMetrics();
      const metrics = await plugin.getMetrics();
      expect(metrics).toHaveLength(0);
    });
  });

  describe('onModuleEvent', () => {
    beforeEach(() => {
      plugin = new PerformancePlugin({
        strategy: 'memory',
        monitorMemory: false,
        monitorCPU: false,
      });
    });

    it('records metrics from module execution complete event', async () => {
      await plugin.onModuleEvent('module.execution.complete', {
        type: 'module.execution.complete',
        data: { moduleName: 'test-module', moduleType: 'processing', duration: 250, success: true },
        timestamp: new Date(),
      });
      const metrics = await plugin.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].operation).toBe('module_execution');
      expect(metrics[0].duration).toBe(250);
    });

    it('records error metrics from module error events', async () => {
      await plugin.onModuleEvent('module.execution.error', {
        type: 'module.execution.error',
        data: { moduleName: 'test-module', moduleType: 'processing', duration: 50 },
        error: new Error('module failed'),
        timestamp: new Date(),
      });
      const metrics = await plugin.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].errorCount).toBe(1);
      expect(metrics[0].success).toBe(false);
    });

    it('ignores unrecognized events', async () => {
      await plugin.onModuleEvent('some.unknown.event' as any, {
        type: 'module.execution.complete' as any,
        data: { duration: 100 },
        timestamp: new Date(),
      });
      const metrics = await plugin.getMetrics();
      expect(metrics).toHaveLength(0);
    });

    it('ignores events without duration', async () => {
      await plugin.onModuleEvent('module.execution.complete', {
        type: 'module.execution.complete',
        data: { moduleName: 'test-module', moduleType: 'processing' },
        timestamp: new Date(),
      });
      const metrics = await plugin.getMetrics();
      expect(metrics).toHaveLength(0);
    });
  });
});
