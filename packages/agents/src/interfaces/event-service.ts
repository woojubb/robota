import type { ToolParameters, ToolResult, ToolExecutionContext } from './tool';
import type { ContextData, LoggerData, MetadataValue, UniversalValue } from './types';

export type EventExtensionValue = UniversalValue | Date | Error | LoggerData | ToolParameters | ToolResult;

/**
 * Service event types for unified tracking
 *
 * IMPORTANT: This module defines the domain-neutral EventService contract.
 * Implementations live in `services/`.
 */
export type ServiceEventType = string;

// OwnerType is intentionally open-ended.
// The system must not assume a fixed set of owner types.
export type OwnerType = string;

export interface OwnerPathSegment {
    type: OwnerType | (string & {});
    id?: string;
}

export interface EventContext {
    ownerType: OwnerType | (string & {});
    ownerId?: string;
    ownerPath: OwnerPathSegment[];
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
export interface BaseEventData {
    /** Event type identifier (e.g., execution.start) */
    eventType?: ServiceEventType;

    /** Source type (open-ended; do not assume a fixed taxonomy) */
    sourceType?: string;

    /** Source identifier (agent ID, team ID, etc.) */
    sourceId?: string;

    /** Event timestamp (auto-generated if not provided) */
    timestamp?: Date;

    /** Additional metadata */
    metadata?: LoggerData;

    // NOTE: ownerPath-derivable hierarchy fields have been removed from payload.
    // Use `context.ownerPath` exclusively for any hierarchy/path decisions.
    /** @deprecated Use domain-specific payload fields instead */
    toolName?: string;
    /** @deprecated Use domain-specific payload fields instead */
    parameters?: ToolParameters | ContextData;
    /** @deprecated Use domain-specific payload fields instead */
    result?: ToolResult;
    /** @deprecated Use domain-specific payload fields instead */
    error?: string;
    /** @deprecated Use domain-specific payload fields instead */
    taskDescription?: string;
    /** @deprecated Migrate to AgentEventData.statusHistory */
    statusHistory?: Array<{ status: string; eventType: string; timestamp: number }>;
    /** Legacy context attachment (EventServiceHookFactory) */
    context?: ContextData;

    /** Allow forward-compat extension fields */
    [key: string]: EventExtensionValue | undefined;
}

export interface ExecutionEventData extends BaseEventData {
    parameters?: ContextData;
    result?: ToolResult;
}

export interface ToolEventData extends BaseEventData {
    toolName?: string;
    parameters?: ToolParameters;
    result?: ToolResult;
    error?: string;
}

export interface AgentEventData extends BaseEventData {
    parameters?: ContextData;
    result?: ToolResult;
    statusHistory?: Array<{ status: string; eventType: string; timestamp: number }>;
}

/** @deprecated Use BaseEventData/ExecutionEventData/ToolEventData/AgentEventData instead */
export type ServiceEventData = BaseEventData;

/**
 * EventService interface - Single event emission point
 *
 * Enhanced with optional methods for hierarchical tracking.
 * These methods are detected via Duck Typing pattern for zero-configuration.
 */
export interface EventService {
    emit<TEvent extends BaseEventData = BaseEventData>(
        eventType: ServiceEventType,
        data: TEvent,
        context?: EventContext
    ): void;

    trackExecution?(executionId: string, parentExecutionId?: string, level?: number): void;

    createBoundEmit?(executionId: string): (eventType: ServiceEventType, data: ServiceEventData) => void;

    createContextBoundInstance?(executionContext: ToolExecutionContext): EventService;
}

export interface EventServiceOwnerBinding {
    ownerType: OwnerType | (string & {});
    ownerId?: string;
    ownerPath?: OwnerPathSegment[];
    sourceType: string;
    sourceId?: string;
}

export const safeStringFromMetadata = (value: MetadataValue | undefined): string | undefined => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return String(value);
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return value.message;
    return undefined;
};


