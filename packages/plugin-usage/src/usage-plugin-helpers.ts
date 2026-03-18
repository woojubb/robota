import {
  PluginCategory,
  PluginPriority,
  ConfigurationError,
  type TEventName,
  EVENT_EMITTER_EVENTS,
} from '@robota-sdk/agents';
import type { IUsagePluginOptions } from './types';

const DEFAULT_MAX_ENTRIES = 10000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_FLUSH_INTERVAL_MS = 60000;
const DEFAULT_AGGREGATION_INTERVAL_MS = 300000;

export type TResolvedUsageOptions = Required<Omit<IUsagePluginOptions, 'costRates'>> & {
  costRates?: Record<string, { input: number; output: number }>;
};

export function resolvePluginOptions(options: IUsagePluginOptions): TResolvedUsageOptions {
  return {
    enabled: options.enabled ?? true,
    strategy: options.strategy,
    filePath: options.filePath ?? './usage-stats.json',
    remoteEndpoint: options.remoteEndpoint ?? '',
    remoteHeaders: options.remoteHeaders ?? {},
    maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
    trackCosts: options.trackCosts ?? true,
    ...(options.costRates && { costRates: options.costRates }),
    batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
    flushInterval: options.flushInterval ?? DEFAULT_FLUSH_INTERVAL_MS,
    aggregateStats: options.aggregateStats ?? true,
    aggregationInterval: options.aggregationInterval ?? DEFAULT_AGGREGATION_INTERVAL_MS,
    category: options.category ?? PluginCategory.MONITORING,
    priority: options.priority ?? PluginPriority.NORMAL,
    moduleEvents: options.moduleEvents ?? [],
    subscribeToAllModuleEvents: options.subscribeToAllModuleEvents ?? false,
  };
}

export function calculateCost(
  costRates: Record<string, { input: number; output: number }> | undefined,
  model: string,
  tokens: { input: number; output: number },
): { input: number; output: number; total: number } | undefined {
  if (!costRates || !costRates[model]) return undefined;
  const rates = costRates[model];
  const inputCost = tokens.input * rates.input;
  const outputCost = tokens.output * rates.output;
  return { input: inputCost, output: outputCost, total: inputCost + outputCost };
}

const VALID_STRATEGIES = ['memory', 'file', 'remote', 'silent'] as const;

export function validateUsageOptions(options: IUsagePluginOptions): void {
  if (!options.strategy) {
    throw new ConfigurationError('Usage tracking strategy is required');
  }
  if (!(VALID_STRATEGIES as readonly string[]).includes(options.strategy)) {
    throw new ConfigurationError('Invalid usage tracking strategy', {
      validStrategies: [...VALID_STRATEGIES],
      provided: options.strategy,
    });
  }
  if (options.strategy === 'file' && !options.filePath) {
    throw new ConfigurationError('File path is required for file usage tracking strategy');
  }
  if (options.strategy === 'remote' && !options.remoteEndpoint) {
    throw new ConfigurationError('Remote endpoint is required for remote usage tracking strategy');
  }
  if (options.maxEntries !== undefined && options.maxEntries <= 0) {
    throw new ConfigurationError('Max entries must be positive');
  }
  if (options.batchSize !== undefined && options.batchSize <= 0) {
    throw new ConfigurationError('Batch size must be positive');
  }
  if (options.flushInterval !== undefined && options.flushInterval <= 0) {
    throw new ConfigurationError('Flush interval must be positive');
  }
  if (options.aggregationInterval !== undefined && options.aggregationInterval <= 0) {
    throw new ConfigurationError('Aggregation interval must be positive');
  }
}

const MODULE_SUCCESS_EVENTS = new Set<TEventName>([
  EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_COMPLETE,
  EVENT_EMITTER_EVENTS.MODULE_EXECUTION_COMPLETE,
  EVENT_EMITTER_EVENTS.MODULE_DISPOSE_COMPLETE,
]);

const MODULE_ERROR_EVENTS = new Set<TEventName>([
  EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_ERROR,
  EVENT_EMITTER_EVENTS.MODULE_EXECUTION_ERROR,
  EVENT_EMITTER_EVENTS.MODULE_DISPOSE_ERROR,
]);

export function isModuleSuccessEvent(eventName: TEventName): boolean {
  return MODULE_SUCCESS_EVENTS.has(eventName);
}

export function isModuleErrorEvent(eventName: TEventName): boolean {
  return MODULE_ERROR_EVENTS.has(eventName);
}

export function extractStringField(data: unknown, field: string): string {
  if (data && typeof data === 'object' && field in data) {
    const value = (data as Record<string, unknown>)[field];
    if (typeof value === 'string') return value;
  }
  return 'unknown';
}

export function resolveOperation(eventName: TEventName): string {
  if (eventName.includes('initialize')) return 'initialization';
  if (eventName.includes('execution')) return 'execution';
  return 'disposal';
}
