import type { TLoggerData, TUniversalValue } from './types';

/**
 * Owner type axis for event context and ownerPath segments.
 *
 * NOTE:
 * - This is intentionally a string axis to allow new owner types without refactoring.
 * - Relationship derivation is still strictly path-only: do not infer from IDs.
 */
export type TOwnerType = string;

/**
 * A single segment in an explicit ownerPath.
 *
 * Path-only rule:
 * - Relationships must be derived from these explicit segments, not from parsing IDs.
 */
export interface IOwnerPathSegment {
    type: TOwnerType;
    id: string;
}

/**
 * Event context that accompanies an emitted event.
 * This is the single source of truth for deterministic linking in subscribers.
 */
export interface IEventContext {
    ownerType: TOwnerType;
    ownerId: string;
    ownerPath: IOwnerPathSegment[];

    /** Optional higher-level execution context */
    rootExecutionId?: string;
    parentExecutionId?: string;
    executionId?: string;

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
    /** Optional linkage duplication for convenience (primary linkage is always in IEventContext). */
    executionId?: string;
    parentExecutionId?: string;
    rootExecutionId?: string;
    ownerPath?: IOwnerPathSegment[];

    /** Optional structured metadata */
    metadata?: TLoggerData;

    /** Extensible fields for event-specific payloads */
    [key: string]: TEventExtensionValue | undefined;
}

/**
 * Canonical event type used by services.
 * Event names are owned by the emitter modules and exported as constants elsewhere.
 */
export type TServiceEventType = string;

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

/**
 * Minimal EventService contract for emitting events.
 * Subscriptions are handled by dedicated modules (e.g., EventEmitterPlugin), not here.
 */
export interface IEventService {
    emit(eventType: TServiceEventType, data: IBaseEventData, context?: IEventContext): void;
}

/**
 * Explicit owner binding information used for scoped event emission.
 */
export interface IEventServiceOwnerBinding {
    ownerType: TOwnerType;
    ownerId: string;
    ownerPath: IOwnerPathSegment[];
    sourceType: TOwnerType;
    sourceId: string;
}

