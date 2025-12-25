import type {
    IAgentEventData,
    IBaseEventData,
    IExecutionEventData,
    IEventContext,
    IEventService,
    IEventServiceOwnerBinding,
    IOwnerPathSegment,
    IToolEventData,
    TOwnerType,
    TServiceEventType
} from '../interfaces/event-service';

export type {
    IAgentEventData,
    IBaseEventData,
    IExecutionEventData,
    IEventContext,
    IEventService,
    IEventServiceOwnerBinding,
    IOwnerPathSegment,
    IToolEventData,
    TOwnerType,
    TServiceEventType
} from '../interfaces/event-service';

/**
 * Abstract base for event services.
 * Concrete implementations decide how events are delivered.
 */
export abstract class AbstractEventService implements IEventService {
    abstract emit(eventType: TServiceEventType, data: IBaseEventData, context?: IEventContext): void;
}

/**
 * Default no-op event service (production-safe).
 * When injected, emit() intentionally does nothing.
 */
export class DefaultEventService extends AbstractEventService {
    emit(_eventType: TServiceEventType, _data: IBaseEventData, _context?: IEventContext): void {
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

    emit(eventType: TServiceEventType, data: IBaseEventData, context?: IEventContext): void {
        const merged: IEventContext = {
            ...context,
            ownerType: this.binding.ownerType,
            ownerId: this.binding.ownerId,
            ownerPath: this.binding.ownerPath
        };
        this.base.emit(eventType, data, merged);
    }
}

/**
 * Bind an EventService to an explicit owner path and source identity.
 * This is the standard entry point for scoped emission (path-only architecture).
 */
export function bindWithOwnerPath(base: IEventService, binding: IEventServiceOwnerBinding): IEventService {
    return new StructuredEventService(base, binding);
}

/**
 * Alias for bindWithOwnerPath for historical call sites.
 * Intentionally forwards to the single authoritative implementation.
 */
export function bindEventServiceOwner(base: IEventService, binding: IEventServiceOwnerBinding): IEventService {
    return bindWithOwnerPath(base, binding);
}

