/**
 * Performance Plugin - Validation, storage factory, and module data extraction helpers.
 *
 * @internal
 */

import { ConfigurationError, EVENT_EMITTER_EVENTS } from '@robota-sdk/agent-core';

import { MemoryPerformanceStorage } from './storages/index';

import type { IPerformancePluginOptions, IPerformanceStorage } from './types';

/** Validate PerformancePlugin constructor options. @internal */
export function validatePerformanceOptions(options: IPerformancePluginOptions): void {
  if (!options.strategy) {
    throw new ConfigurationError('Performance monitoring strategy is required');
  }

  if (!['memory', 'file', 'prometheus', 'remote', 'silent'].includes(options.strategy)) {
    throw new ConfigurationError('Invalid performance monitoring strategy', {
      validStrategies: ['memory', 'file', 'prometheus', 'remote', 'silent'],
      provided: options.strategy,
    });
  }

  const explicitlyMonitored = options.monitorMemory || options.monitorCPU || options.monitorNetwork;
  if (explicitlyMonitored && !options.metricsCollector) {
    throw new ConfigurationError(
      'A `metricsCollector` is required to monitor memory, CPU or network — agent-plugin is ' +
        'platform-neutral and reads no host metrics; inject an ISystemMetricsCollector ' +
        '(NodeSystemMetricsCollector from @robota-sdk/agent-plugin/node).',
    );
  }
}

/** Create IPerformanceStorage instance for the given strategy. @internal */
export function createPerformanceStorage(
  strategy: string,
  maxEntries: number,
): IPerformanceStorage {
  switch (strategy) {
    case 'memory':
      return new MemoryPerformanceStorage(maxEntries);
    default:
      throw new ConfigurationError('Performance monitoring strategy is not implemented', {
        provided: strategy,
      });
  }
}

/** Event name → performance metrics descriptor mapping. @internal */
export const PERFORMANCE_MODULE_EVENT_MAP: ReadonlyMap<
  string,
  { operation: string; phase: string; isError: boolean }
> = new Map([
  [
    EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_COMPLETE,
    { operation: 'module_initialization', phase: 'initialization', isError: false },
  ],
  [
    EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_ERROR,
    { operation: 'module_initialization', phase: 'initialization', isError: true },
  ],
  [
    EVENT_EMITTER_EVENTS.MODULE_EXECUTION_COMPLETE,
    { operation: 'module_execution', phase: 'execution', isError: false },
  ],
  [
    EVENT_EMITTER_EVENTS.MODULE_EXECUTION_ERROR,
    { operation: 'module_execution', phase: 'execution', isError: true },
  ],
  [
    EVENT_EMITTER_EVENTS.MODULE_DISPOSE_COMPLETE,
    { operation: 'module_disposal', phase: 'disposal', isError: false },
  ],
  [
    EVENT_EMITTER_EVENTS.MODULE_DISPOSE_ERROR,
    { operation: 'module_disposal', phase: 'disposal', isError: true },
  ],
]);

/** Safely extract module data fields from untyped event payload. @internal */
export function extractPerformanceModuleData(data: unknown): {
  moduleName: string;
  moduleType: string;
  duration?: number;
  success?: boolean;
} {
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  return {
    moduleName: typeof record['moduleName'] === 'string' ? record['moduleName'] : 'unknown',
    moduleType: typeof record['moduleType'] === 'string' ? record['moduleType'] : 'unknown',
    ...(typeof record['duration'] === 'number' && { duration: record['duration'] }),
    ...(typeof record['success'] === 'boolean' && { success: record['success'] }),
  };
}
