/**
 * @fileoverview Event service interface definitions.
 *
 * These interfaces are owned by @robota-sdk/agent-event-service and serve as the
 * single source of truth for event-related contracts.
 * @robota-sdk/agent-core imports these types from this package.
 */

/**
 * Primitive value types for event payloads.
 */
export type TEventPrimitiveValue = string | number | boolean | null | undefined;

/**
 * Recursive universal value type for event payloads (JSON-like + Date).
 */
export type TEventUniversalValue =
  | TEventPrimitiveValue
  | Date
  | TEventUniversalValue[]
  | IEventObjectValue;

export interface IEventObjectValue {
  [key: string]: TEventUniversalValue;
}

/**
 * Logger data type for event metadata.
 */
export type TEventLoggerData = Record<string, TEventUniversalValue | Date | Error>;

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

  /** Depth of the current execution in the hierarchy (0 = root) */
  depth?: number;

  /** Unique span identifier for distributed tracing correlation */
  spanId?: string;

  /** Optional structured metadata for debugging/observability */
  metadata?: TEventLoggerData;
}

/**
 * Allowed extension values for event payloads.
 */
export type TEventExtensionValue =
  | TEventUniversalValue
  | TEventLoggerData
  | Error
  | IEventContext
  | IOwnerPathSegment[];

/**
 * Base event payload shape.
 * Emitters may add additional fields, but MUST keep linkage information explicit.
 */
export interface IBaseEventData {
  /** Timestamp when the event was emitted. This is required for deterministic ordering. */
  timestamp: Date;

  /** Optional structured metadata */
  metadata?: TEventLoggerData;

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
  parameters?: Record<string, TEventUniversalValue>;
}

/**
 * Agent-related event payload.
 */
export interface IAgentEventData extends IBaseEventData {
  agentId?: string;
}

export type TEventListener = (
  eventType: string,
  data: IBaseEventData,
  context?: IEventContext,
) => void;

/**
 * Minimal EventService contract for emitting events.
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
