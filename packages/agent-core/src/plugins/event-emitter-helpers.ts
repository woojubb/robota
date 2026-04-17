/**
 * Helper functions for EventEmitterPlugin.
 *
 * Extracted from plugins/event-emitter-plugin.ts to keep that file under 300 lines.
 * Contains validation logic, event processing, and stats computation.
 */
import { PluginError } from '../utils/errors';
import type { ILogger } from '../utils/logger';
import type {
  IEventEmitterEventData,
  TEventName,
  TEventEmitterListener,
} from './event-emitter/types';
import type {
  IEventEmitterHandlerRegistration,
  IEventEmitterPluginOptions,
  IEventEmitterPluginStats,
} from './event-emitter/plugin-types';
import type { IEventEmitterMetrics } from './event-emitter/metrics';

/**
 * Validate EventEmitterPlugin constructor options.
 * Throws PluginError if any value is out of range.
 */
export function validateEventEmitterOptions(
  options: IEventEmitterPluginOptions,
  pluginName: string,
): void {
  if (options.maxListeners !== undefined && options.maxListeners < 0)
    throw new PluginError(
      `Invalid maxListeners option: ${options.maxListeners}. Must be a non-negative number.`,
      pluginName,
      { maxListeners: options.maxListeners },
    );
  if (
    options.buffer !== undefined &&
    options.buffer.maxSize !== undefined &&
    options.buffer.maxSize < 0
  )
    throw new PluginError(
      `Invalid buffer.maxSize option: ${options.buffer.maxSize}. Must be a non-negative number.`,
      pluginName,
      { bufferMaxSize: options.buffer.maxSize },
    );
  if (
    options.buffer !== undefined &&
    options.buffer.flushInterval !== undefined &&
    options.buffer.flushInterval < 0
  )
    throw new PluginError(
      `Invalid buffer.flushInterval option: ${options.buffer.flushInterval}. Must be a non-negative number.`,
      pluginName,
      { bufferFlushInterval: options.buffer.flushInterval },
    );
}

/**
 * Execute a single registered event handler, catching errors via metrics.
 */
export async function executeEventHandler(
  handler: IEventEmitterHandlerRegistration,
  event: IEventEmitterEventData,
  metrics: IEventEmitterMetrics,
  catchErrors: boolean,
  logger: ILogger,
): Promise<void> {
  try {
    await handler.listener(event);
  } catch (error) {
    metrics.incrementErrors();
    if (catchErrors) {
      logger.error('Event handler error', {
        eventType: event.type,
        handlerId: handler.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Process a single event by dispatching it to matching registered handlers.
 * Handles once-only removal and async vs sequential dispatch.
 */
export async function processEvent(
  event: IEventEmitterEventData,
  handlers: Map<TEventName, IEventEmitterHandlerRegistration[]>,
  asyncMode: boolean,
  offFn: (eventType: TEventName, id: string) => void,
  execHandler: (
    handler: IEventEmitterHandlerRegistration,
    event: IEventEmitterEventData,
  ) => Promise<void>,
): Promise<void> {
  const eventHandlers = handlers.get(event.type);
  if (!eventHandlers || eventHandlers.length === 0) return;
  const handlersToCall = eventHandlers.filter((h) => !h.filter || h.filter(event));
  if (handlersToCall.length === 0) return;
  for (const h of handlersToCall.filter((h) => h.once)) offFn(event.type, h.id);
  if (asyncMode) {
    await Promise.all(handlersToCall.map((h) => execHandler(h, event)));
    return;
  }
  for (const h of handlersToCall) await execHandler(h, event);
}

/**
 * Compute the listener-count stats portion of EventEmitterPlugin.getStats().
 */
export function computeListenerStats(
  handlers: Map<TEventName, IEventEmitterHandlerRegistration[]>,
): { listenerCounts: Partial<Record<TEventName, number>>; totalListeners: number } {
  const listenerCounts: Partial<Record<TEventName, number>> = {};
  let totalListeners = 0;
  for (const [eventType, hs] of handlers) {
    listenerCounts[eventType] = hs.length;
    totalListeners += hs.length;
  }
  return { listenerCounts, totalListeners };
}

/**
 * Build the full IEventEmitterPluginStats object.
 */
export function buildEventEmitterStats(
  base: Omit<
    IEventEmitterPluginStats,
    | 'eventTypes'
    | 'listenerCounts'
    | 'totalListeners'
    | 'bufferedEvents'
    | 'totalEmitted'
    | 'totalErrors'
  >,
  handlers: Map<TEventName, IEventEmitterHandlerRegistration[]>,
  bufferedEvents: number,
  metrics: IEventEmitterMetrics,
): IEventEmitterPluginStats {
  const { listenerCounts, totalListeners } = computeListenerStats(handlers);
  const metricsSnapshot = metrics.getSnapshot();
  const enabled = base.enabled as boolean;
  const calls = base.calls as number;
  const errors = base.errors as number;
  return {
    enabled,
    calls,
    errors,
    eventTypes: Array.from(handlers.keys()),
    listenerCounts,
    totalListeners,
    bufferedEvents,
    totalEmitted: metricsSnapshot.totalEmitted,
    totalErrors: metricsSnapshot.totalErrors,
  };
}

/** Register a handler in the handlers map, enforcing max listeners. */
export function registerHandler(
  handlers: Map<TEventName, IEventEmitterHandlerRegistration[]>,
  eventType: TEventName,
  handlerId: string,
  listener: TEventEmitterListener,
  options: { once?: boolean; filter?: (event: IEventEmitterEventData) => boolean } | undefined,
  maxListeners: number,
  pluginName: string,
): void {
  if (!handlers.has(eventType)) handlers.set(eventType, []);
  const hs = handlers.get(eventType)!;
  if (hs.length >= maxListeners) {
    throw new PluginError(
      `Maximum listeners (${maxListeners}) exceeded for event type: ${eventType}`,
      pluginName,
      { eventType, currentListeners: hs.length },
    );
  }
  hs.push({
    id: handlerId,
    listener,
    once: options?.once ?? false,
    ...(options?.filter && { filter: options.filter }),
  });
}

/** Remove a handler by id or listener reference. Returns true if removed. */
export function unregisterHandler(
  handlers: Map<TEventName, IEventEmitterHandlerRegistration[]>,
  eventType: TEventName,
  handlerIdOrListener: string | TEventEmitterListener,
): boolean {
  const hs = handlers.get(eventType);
  if (!hs) return false;
  const index =
    typeof handlerIdOrListener === 'string'
      ? hs.findIndex((h) => h.id === handlerIdOrListener)
      : hs.findIndex((h) => h.listener === handlerIdOrListener);
  if (index !== -1) {
    hs.splice(index, 1);
    return true;
  }
  return false;
}
