export type {
  IAgentEventData,
  IBaseEventData,
  IExecutionEventData,
  IEventContext,
  IEventService,
  IEventServiceOwnerBinding,
  IOwnerPathSegment,
  IToolEventData,
  TEventListener,
} from './interfaces';

import type {
  IBaseEventData,
  IEventContext,
  IEventService,
  IEventServiceOwnerBinding,
  TEventListener,
} from './interfaces';

/**
 * Abstract base for event services.
 * Concrete implementations decide how events are delivered.
 */
export abstract class AbstractEventService implements IEventService {
  private listeners = new Set<TEventListener>();

  abstract emit(eventType: string, data: IBaseEventData, context?: IEventContext): void;

  subscribe(listener: TEventListener): void {
    this.listeners.add(listener);
  }

  unsubscribe(listener: TEventListener): void {
    this.listeners.delete(listener);
  }

  protected notifyListeners(
    eventType: string,
    data: IBaseEventData,
    context?: IEventContext,
  ): void {
    for (const listener of this.listeners) {
      listener(eventType, data, context);
    }
  }
}

/**
 * Default no-op event service (production-safe).
 * When injected, emit() intentionally does nothing.
 */
export class DefaultEventService extends AbstractEventService {
  emit(_eventType: string, _data: IBaseEventData, _context?: IEventContext): void {
    // Intentionally empty: no-op event service.
  }
}

/**
 * Singleton default event service instance.
 */
export const DEFAULT_ABSTRACT_EVENT_SERVICE: IEventService = new DefaultEventService();

/**
 * Check if a given service is the default no-op implementation.
 */
export function isDefaultEventService(service: IEventService): boolean {
  return service === DEFAULT_ABSTRACT_EVENT_SERVICE || service instanceof DefaultEventService;
}

/**
 * Compose a full event name from owner prefix and local name.
 * Local names must not contain dots.
 */
export function composeEventName(ownerType: string, localName: string): string {
  if (!ownerType || ownerType.trim().length === 0) {
    throw new Error('[EVENTS] ownerType is required to compose event names.');
  }
  if (ownerType.includes('.')) {
    throw new Error(`[EVENTS] ownerType must not contain '.': "${ownerType}"`);
  }
  if (!localName || localName.trim().length === 0) {
    throw new Error('[EVENTS] local event name is required.');
  }
  if (localName.includes('.')) {
    throw new Error(`[EVENTS] Local event name must not contain '.': "${localName}"`);
  }
  return `${ownerType}.${localName}`;
}

const ID_RADIX = 36;
const SPAN_ID_SUBSTR_END = 10;

/**
 * Generate a unique span ID for distributed tracing correlation.
 */
function generateSpanId(): string {
  return `span_${Date.now().toString(ID_RADIX)}_${Math.random().toString(ID_RADIX).slice(2, SPAN_ID_SUBSTR_END)}`;
}

/**
 * A scoped event service that always emits with an owner binding applied.
 */
export class StructuredEventService extends AbstractEventService {
  private readonly base: IEventService;
  private readonly binding: IEventServiceOwnerBinding;

  constructor(base: IEventService, binding: IEventServiceOwnerBinding) {
    super();
    this.base = base;
    this.binding = binding;
  }

  emit(eventType: string, data: IBaseEventData, context?: IEventContext): void {
    if (eventType.includes('.')) {
      throw new Error(`[EVENTS] Local event name must not contain '.': "${eventType}"`);
    }
    const merged: IEventContext = {
      ...context,
      ownerType: this.binding.ownerType,
      ownerId: this.binding.ownerId,
      ownerPath: this.binding.ownerPath,
      depth: this.binding.ownerPath.length,
      spanId: context?.spanId ?? generateSpanId(),
    };
    const fullEventName = composeEventName(this.binding.ownerType, eventType);
    this.base.emit(fullEventName, data, merged);
  }

  override subscribe(listener: TEventListener): void {
    this.base.subscribe(listener);
  }

  override unsubscribe(listener: TEventListener): void {
    this.base.unsubscribe(listener);
  }
}

/**
 * Bind an EventService to an explicit owner path.
 * This is the standard entry point for scoped emission (path-only architecture).
 */
export function bindWithOwnerPath(
  base: IEventService,
  binding: IEventServiceOwnerBinding,
): IEventService {
  return new StructuredEventService(base, binding);
}

/**
 * Alias for bindWithOwnerPath for historical call sites.
 * Intentionally forwards to the single authoritative implementation.
 */
export function bindEventServiceOwner(
  base: IEventService,
  binding: IEventServiceOwnerBinding,
): IEventService {
  return bindWithOwnerPath(base, binding);
}

/**
 * Observable EventService that notifies subscribed listeners.
 */
export class ObservableEventService extends AbstractEventService {
  emit(eventType: string, data: IBaseEventData, context?: IEventContext): void {
    this.notifyListeners(eventType, data, context);
  }
}
