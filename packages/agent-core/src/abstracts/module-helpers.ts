/**
 * Helper functions for AbstractModule.
 *
 * Extracted from abstracts/abstract-module.ts to keep that file under 300 lines.
 * Contains context data extraction, event payload conversion, and stats utilities.
 */
import type { TEventDataValue, IEventEmitterPlugin } from '../plugins/event-emitter/types';
import { EVENT_EMITTER_EVENTS } from '../plugins/event-emitter/types';
import type {
  IModuleInitializationEventData,
  IModuleExecutionEventData,
  IModuleDisposalEventData,
} from './abstract-module-events';
import type {
  IModuleExecutionContext,
  IModuleStats,
  IModuleCapabilities,
  IModuleDescriptor,
  IModuleData,
} from './abstract-module-types';

/**
 * Extract string context fields from an execution context for event emission.
 * Only sessionId, userId, and agentName are included.
 */
export function buildModuleContextData(context: IModuleExecutionContext): Record<string, string> {
  const cd: Record<string, string> = {};
  if (context['sessionId']) cd['sessionId'] = context['sessionId'];
  if (context['userId']) cd['userId'] = context['userId'];
  if (context['agentName']) cd['agentName'] = context['agentName'];
  return cd;
}

/**
 * Convert a typed module event data object to a flat Record<string, TEventDataValue>
 * suitable for passing to the event emitter.
 */
export function convertModuleEventData(
  data: IModuleInitializationEventData | IModuleExecutionEventData | IModuleDisposalEventData,
): Record<string, TEventDataValue> {
  const payload: Record<string, TEventDataValue> = {
    moduleName: data.moduleName,
    moduleType: data.moduleType,
    timestamp: data.timestamp.toISOString(),
  };
  if (data.metadata) payload['metadata'] = data.metadata;
  if ('phase' in data) payload['phase'] = data.phase;
  if ('duration' in data && data.duration !== undefined) payload['duration'] = data.duration;
  if ('error' in data && data.error !== undefined) payload['error'] = data.error;
  if ('options' in data && data.options) payload['options'] = data.options;
  if ('executionId' in data) payload['executionId'] = data.executionId;
  if ('success' in data && data.success !== undefined) payload['success'] = data.success;
  if ('inputSize' in data && data.inputSize !== undefined) payload['inputSize'] = data.inputSize;
  if ('outputSize' in data && data.outputSize !== undefined)
    payload['outputSize'] = data.outputSize;
  if ('context' in data && data.context) payload['context'] = data.context;
  return payload;
}

/** Emit a module lifecycle event, converting data to the emitter's format. */
export async function emitModuleEvent(
  eventEmitter: IEventEmitterPlugin,
  eventName: string,
  data: IModuleInitializationEventData | IModuleExecutionEventData | IModuleDisposalEventData,
  error?: Error,
): Promise<void> {
  await eventEmitter.emit(eventName, {
    data: convertModuleEventData(data),
    timestamp: new Date(),
    ...(error && { error }),
  });
}

/**
 * Build the standard IModuleData descriptor for a module.
 */
export function buildModuleData(
  name: string,
  version: string,
  getModuleType: () => IModuleDescriptor,
  enabled: boolean,
  initialized: boolean,
  getCapabilities: () => IModuleCapabilities,
): IModuleData {
  return {
    name,
    version,
    type: getModuleType().type,
    enabled,
    initialized,
    capabilities: getCapabilities(),
    metadata: { category: getModuleType().category, layer: getModuleType().layer },
  };
}

/**
 * Build the standard IModuleStats object for a module.
 */
export function buildModuleStats(
  stats: {
    executionCount: number;
    errorCount: number;
    lastActivity: Date | undefined;
    totalExecutionTime: number;
  },
  enabled: boolean,
  initialized: boolean,
): IModuleStats {
  const avg =
    stats.executionCount > 0 ? stats.totalExecutionTime / stats.executionCount : undefined;
  return {
    enabled,
    initialized,
    executionCount: stats.executionCount,
    errorCount: stats.errorCount,
    ...(stats.lastActivity && { lastActivity: stats.lastActivity }),
    ...(avg !== undefined && { averageExecutionTime: avg }),
  };
}

/**
 * Extract only scalar (string | number | boolean) entries from options for event emission.
 */
export function filterScalarOptions(options: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(options).filter(
      ([_, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
    ),
  );
}

/** Emit lifecycle events for module initialization phase. */
export async function emitInitializeStartEvent(
  eventEmitter: IEventEmitterPlugin | undefined,
  enabled: boolean,
  moduleName: string,
  moduleType: string,
  filteredOptions: Record<string, unknown> | undefined,
): Promise<void> {
  if (!eventEmitter || !enabled) return;
  await emitModuleEvent(eventEmitter, EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_START, {
    moduleName,
    moduleType,
    phase: 'start',
    timestamp: new Date(),
    ...(filteredOptions && Object.keys(filteredOptions).length > 0 && { options: filteredOptions }),
  });
}

export async function emitInitializeCompleteEvent(
  eventEmitter: IEventEmitterPlugin | undefined,
  enabled: boolean,
  moduleName: string,
  moduleType: string,
  startTime: number,
): Promise<void> {
  if (!eventEmitter || !enabled) return;
  await emitModuleEvent(eventEmitter, EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_COMPLETE, {
    moduleName,
    moduleType,
    phase: 'complete',
    timestamp: new Date(),
    duration: Date.now() - startTime,
  });
}

export async function emitInitializeErrorEvent(
  eventEmitter: IEventEmitterPlugin | undefined,
  moduleName: string,
  moduleType: string,
  startTime: number,
  error: Error,
): Promise<void> {
  if (!eventEmitter) return;
  await emitModuleEvent(
    eventEmitter,
    EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_ERROR,
    {
      moduleName,
      moduleType,
      phase: 'error',
      timestamp: new Date(),
      duration: Date.now() - startTime,
      error: error.message,
    },
    error,
  );
}

export async function emitDisposeStartEvent(
  eventEmitter: IEventEmitterPlugin | undefined,
  initialized: boolean,
  moduleName: string,
  moduleType: string,
): Promise<void> {
  if (!eventEmitter || !initialized) return;
  await emitModuleEvent(eventEmitter, EVENT_EMITTER_EVENTS.MODULE_DISPOSE_START, {
    moduleName,
    moduleType,
    phase: 'start',
    timestamp: new Date(),
  });
}

export async function emitDisposeCompleteEvent(
  eventEmitter: IEventEmitterPlugin | undefined,
  moduleName: string,
  moduleType: string,
  startTime: number,
): Promise<void> {
  if (!eventEmitter) return;
  await emitModuleEvent(eventEmitter, EVENT_EMITTER_EVENTS.MODULE_DISPOSE_COMPLETE, {
    moduleName,
    moduleType,
    phase: 'complete',
    timestamp: new Date(),
    duration: Date.now() - startTime,
    resourcesReleased: ['memory', 'event-handlers', 'timers'],
  });
}

export async function emitDisposeErrorEvent(
  eventEmitter: IEventEmitterPlugin | undefined,
  moduleName: string,
  moduleType: string,
  startTime: number,
  error: Error,
): Promise<void> {
  if (!eventEmitter) return;
  await emitModuleEvent(
    eventEmitter,
    EVENT_EMITTER_EVENTS.MODULE_DISPOSE_ERROR,
    {
      moduleName,
      moduleType,
      phase: 'error',
      timestamp: new Date(),
      duration: Date.now() - startTime,
      error: error.message,
    },
    error,
  );
}
