import type { TToolResult, TToolExecutionContext } from './tool';
import type { TContextData, TLoggerData, TMetadataValue, TUniversalValue } from './types';
import type { TToolParameters } from './types';

export type TEventExtensionValue = TUniversalValue | Date | Error | TLoggerData | TToolParameters | TToolResult;

/**
 * Service event types for unified tracking
 *
 * IMPORTANT: This module defines the domain-neutral EventService contract.
 * Implementations live in `services/`.
 */
export type TServiceEventType = string;

// OwnerType is intentionally open-ended.
// The system must not assume a fixed set of owner types.
export type TOwnerType = string;

export interface IOwnerPathSegment {
    type: TOwnerType | (string & {});
    id?: string;
}

export interface IEventContext {
    ownerType: TOwnerType | (string & {});
    ownerId?: string;
    ownerPath: IOwnerPathSegment[];
    sourceId?: string;
    timestamp?: Date;
}

/**
 * Service event data structure.
 *
 * NOTE:
 * - Prefer "payload=domain data-only" and "context=ownerPath-only".
 * - Deprecated fields remain for compatibility during migration.
 */
export interface IBaseEventData {
    /** Event type identifier (e.g., execution.start) */
    eventType?: TServiceEventType;

    /** Source type (open-ended; do not assume a fixed taxonomy) */
    sourceType?: string;

    /** Source identifier (agent ID, team ID, etc.) */
    sourceId?: string;

    /** Event timestamp (auto-generated if not provided) */
    timestamp?: Date;

    /** Additional metadata */
    metadata?: TLoggerData;

    // NOTE: ownerPath-derivable hierarchy fields have been removed from payload.
    // Use `context.ownerPath` exclusively for any hierarchy/path decisions.
    /** @deprecated Use domain-specific payload fields instead */
    toolName?: string;
    /** @deprecated Use domain-specific payload fields instead */
    parameters?: TToolParameters | TContextData;
    /** @deprecated Use domain-specific payload fields instead */
    result?: TToolResult;
    /** @deprecated Use domain-specific payload fields instead */
    error?: string;
    /** @deprecated Use domain-specific payload fields instead */
    taskDescription?: string;
    /** @deprecated Migrate to AgentEventData.statusHistory */
    statusHistory?: Array<{ status: string; eventType: string; timestamp: number }>;
    /** Legacy context attachment (EventServiceHookFactory) */
    context?: TContextData;

    /** Allow forward-compat extension fields */
    [key: string]: TEventExtensionValue | undefined;
}

export interface IExecutionEventData extends IBaseEventData {
    parameters?: TContextData;
    result?: TToolResult;
}

export interface IToolEventData extends IBaseEventData {
    toolName?: string;
    parameters?: TToolParameters;
    result?: TToolResult;
    error?: string;
}

export interface IAgentEventData extends IBaseEventData {
    parameters?: TContextData;
    result?: TToolResult;
    statusHistory?: Array<{ status: string; eventType: string; timestamp: number }>;
}

/** @deprecated Use BaseEventData/ExecutionEventData/ToolEventData/AgentEventData instead */
export type TServiceEventData = IBaseEventData;

/**
 * EventService interface - Single event emission point
 *
 * Enhanced with optional methods for hierarchical tracking.
 * These methods are detected via Duck Typing pattern for zero-configuration.
 */
export interface IEventService {
    emit<TEvent extends IBaseEventData = IBaseEventData>(
        eventType: TServiceEventType,
        data: TEvent,
        context?: IEventContext
    ): void;

    trackExecution?(executionId: string, parentExecutionId?: string, level?: number): void;

    createBoundEmit?(executionId: string): (eventType: TServiceEventType, data: TServiceEventData) => void;

    createContextBoundInstance?(executionContext: TToolExecutionContext): IEventService;
}

export interface IEventServiceOwnerBinding {
    ownerType: TOwnerType | (string & {});
    ownerId?: string;
    ownerPath?: IOwnerPathSegment[];
    sourceType: string;
    sourceId?: string;
}

export const safeStringFromMetadata = (value: TMetadataValue | undefined): string | undefined => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return String(value);
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return value.message;
    return undefined;
};


