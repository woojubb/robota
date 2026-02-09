import type { TLoggerData, TUniversalValue } from './types';

/**
 * A single segment in an explicit ownerPath.
 *
 * Path-only rule:
 * - Relationships must be derived from these explicit segments, not from parsing IDs.
 */
export interface IOwnerPathSegment {
    type: string;
    id: string;
}

/**
 * Event context that accompanies an emitted event.
 * This is the single source of truth for deterministic linking in subscribers.
 */
export interface IEventContext {
    ownerType: string;
    ownerId: string;
    ownerPath: IOwnerPathSegment[];

    /** Optional structured metadata for debugging/observability */
    metadata?: TLoggerData;
}

/**
 * Allowed extension values for event payloads.
 *
 * NOTE:
 * - Must not use `any`/`unknown`.
 * - Includes IEventContext so `context` can be carried in data bags when needed.
 */
export type TEventExtensionValue = TUniversalValue | TLoggerData | Error | IEventContext | IOwnerPathSegment[];

/**
 * Base event payload shape.
 * Emitters may add additional fields, but MUST keep linkage information explicit.
 */
export interface IBaseEventData {
    /** Timestamp when the event was emitted. This is required for deterministic ordering. */
    timestamp: Date;

    /** Optional structured metadata */
    metadata?: TLoggerData;

    /** Extensible fields for event-specific payloads */
    [key: string]: TEventExtensionValue | undefined;
}

/**
 * Execution-related event payload.
 */
export interface IExecutionEventData extends IBaseEventData {}

/**
 * Tool-related event payload.
 */
export interface IToolEventData extends IBaseEventData {
    toolName?: string;
    parameters?: Record<string, TUniversalValue>;
}

/**
 * Agent-related event payload.
 */
export interface IAgentEventData extends IBaseEventData {
    agentId?: string;
}

export type TEventListener = (eventType: string, data: IBaseEventData, context?: IEventContext) => void;

/**
 * Minimal EventService contract for emitting events.
 * Subscriptions are handled by dedicated modules (e.g., EventEmitterPlugin), not here.
 */
export interface IEventService {
    emit(eventType: string, data: IBaseEventData, context?: IEventContext): void;
    subscribe(listener: TEventListener): void;
    unsubscribe(listener: TEventListener): void;
}

/**
 * Explicit owner binding information used for scoped event emission.
 */
export interface IEventServiceOwnerBinding {
    ownerType: string;
    ownerId: string;
    ownerPath: IOwnerPathSegment[];
}

