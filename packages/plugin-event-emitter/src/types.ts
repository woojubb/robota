import {
  AGENT_EVENTS,
  AGENT_EVENT_PREFIX,
  EXECUTION_EVENTS,
  EXECUTION_EVENT_PREFIX,
  TOOL_EVENTS,
  TOOL_EVENT_PREFIX,
} from '@robota-sdk/agents';

const buildEventName = <TPrefix extends string, TLocal extends string>(
  prefix: TPrefix,
  localName: TLocal,
): `${TPrefix}.${TLocal}` => `${prefix}.${localName}`;

const EXECUTION_EVENT_NAMES = {
  START: buildEventName(EXECUTION_EVENT_PREFIX, EXECUTION_EVENTS.START),
  COMPLETE: buildEventName(EXECUTION_EVENT_PREFIX, EXECUTION_EVENTS.COMPLETE),
  ERROR: buildEventName(EXECUTION_EVENT_PREFIX, EXECUTION_EVENTS.ERROR),
} as const;

const TOOL_EVENT_NAMES = {
  CALL_START: buildEventName(TOOL_EVENT_PREFIX, TOOL_EVENTS.CALL_START),
  CALL_COMPLETE: buildEventName(TOOL_EVENT_PREFIX, TOOL_EVENTS.CALL_COMPLETE),
  CALL_ERROR: buildEventName(TOOL_EVENT_PREFIX, TOOL_EVENTS.CALL_ERROR),
} as const;

const AGENT_EVENT_NAMES = {
  EXECUTION_START: buildEventName(AGENT_EVENT_PREFIX, AGENT_EVENTS.EXECUTION_START),
  EXECUTION_COMPLETE: buildEventName(AGENT_EVENT_PREFIX, AGENT_EVENTS.EXECUTION_COMPLETE),
  EXECUTION_ERROR: buildEventName(AGENT_EVENT_PREFIX, AGENT_EVENTS.EXECUTION_ERROR),
  CREATED: buildEventName(AGENT_EVENT_PREFIX, AGENT_EVENTS.CREATED),
} as const;

export type TExecutionEventName =
  (typeof EXECUTION_EVENT_NAMES)[keyof typeof EXECUTION_EVENT_NAMES];
type TToolEventName = (typeof TOOL_EVENT_NAMES)[keyof typeof TOOL_EVENT_NAMES];
type TAgentEventName = (typeof AGENT_EVENT_NAMES)[keyof typeof AGENT_EVENT_NAMES];

/**
 * Event types that can be emitted.
 *
 * IMPORTANT:
 * - Do not use string literals for event names outside this module.
 * - Import and use EVENT_EMITTER_EVENTS instead.
 */
export const EVENT_EMITTER_EVENTS = {
  EXECUTION_START: EXECUTION_EVENT_NAMES.START,
  EXECUTION_COMPLETE: EXECUTION_EVENT_NAMES.COMPLETE,
  EXECUTION_ERROR: EXECUTION_EVENT_NAMES.ERROR,
  TOOL_BEFORE_EXECUTE: 'tool.beforeExecute',
  TOOL_AFTER_EXECUTE: 'tool.afterExecute',
  TOOL_SUCCESS: 'tool.success',
  TOOL_ERROR: TOOL_EVENT_NAMES.CALL_ERROR,
  CONVERSATION_START: 'conversation.start',
  CONVERSATION_COMPLETE: 'conversation.complete',
  CONVERSATION_ERROR: 'conversation.error',
  AGENT_EXECUTION_START: AGENT_EVENT_NAMES.EXECUTION_START,
  AGENT_EXECUTION_COMPLETE: AGENT_EVENT_NAMES.EXECUTION_COMPLETE,
  AGENT_EXECUTION_ERROR: AGENT_EVENT_NAMES.EXECUTION_ERROR,
  AGENT_CREATED: AGENT_EVENT_NAMES.CREATED,
  AGENT_DESTROYED: 'agent.destroyed',
  PLUGIN_LOADED: 'plugin.loaded',
  PLUGIN_UNLOADED: 'plugin.unloaded',
  PLUGIN_ERROR: 'plugin.error',
  ERROR_OCCURRED: 'error.occurred',
  WARNING_OCCURRED: 'warning.occurred',
  MODULE_INITIALIZE_START: 'module.initialize.start',
  MODULE_INITIALIZE_COMPLETE: 'module.initialize.complete',
  MODULE_INITIALIZE_ERROR: 'module.initialize.error',
  MODULE_EXECUTION_START: 'module.execution.start',
  MODULE_EXECUTION_COMPLETE: 'module.execution.complete',
  MODULE_EXECUTION_ERROR: 'module.execution.error',
  MODULE_DISPOSE_START: 'module.dispose.start',
  MODULE_DISPOSE_COMPLETE: 'module.dispose.complete',
  MODULE_DISPOSE_ERROR: 'module.dispose.error',
  MODULE_REGISTERED: 'module.registered',
  MODULE_UNREGISTERED: 'module.unregistered',
  EXECUTION_HIERARCHY: 'execution.hierarchy',
  EXECUTION_REALTIME: 'execution.realtime',
  TOOL_REALTIME: 'tool.realtime',
  CUSTOM: 'custom',
} as const;

export type TEventName =
  | TExecutionEventName
  | TToolEventName
  | TAgentEventName
  | 'tool.beforeExecute'
  | 'tool.afterExecute'
  | 'tool.success'
  | 'conversation.start'
  | 'conversation.complete'
  | 'conversation.error'
  | 'agent.destroyed'
  | 'plugin.loaded'
  | 'plugin.unloaded'
  | 'plugin.error'
  | 'error.occurred'
  | 'warning.occurred'
  | 'module.initialize.start'
  | 'module.initialize.complete'
  | 'module.initialize.error'
  | 'module.execution.start'
  | 'module.execution.complete'
  | 'module.execution.error'
  | 'module.dispose.start'
  | 'module.dispose.complete'
  | 'module.dispose.error'
  | 'module.registered'
  | 'module.unregistered'
  | 'execution.hierarchy'
  | 'execution.realtime'
  | 'tool.realtime'
  | 'custom';

/**
 * Valid event data value types
 */
export type TEventDataValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | TEventDataValue[]
  | { [key: string]: TEventDataValue };

/**
 * Event data structure
 */
export interface IEventEmitterEventData {
  type: TEventName;
  timestamp: Date;
  executionId?: string;
  sessionId?: string;
  userId?: string;
  data?: Record<string, TEventDataValue>;
  error?: Error;
  metadata?: Record<string, TEventDataValue>;
}

/**
 * Event listener function
 */
export type TEventEmitterListener = (event: IEventEmitterEventData) => void | Promise<void>;

/**
 * Console-like interface for the EventEmitterPlugin.
 *
 * Use this interface for typing instead of the concrete EventEmitterPlugin class.
 */
export interface IEventEmitterPlugin {
  on(
    eventType: TEventName,
    listener: TEventEmitterListener,
    options?: {
      once?: boolean;
      filter?: (event: IEventEmitterEventData) => boolean;
    },
  ): string;
  once(
    eventType: TEventName,
    listener: TEventEmitterListener,
    filter?: (event: IEventEmitterEventData) => boolean,
  ): string;
  off(eventType: TEventName, handlerIdOrListener: string | TEventEmitterListener): boolean;
  emit(eventType: TEventName, eventData?: Partial<IEventEmitterEventData>): Promise<void>;
}

/**
 * Event handler with metadata
 */
export interface IEventEmitterHandler {
  id: string;
  listener: TEventEmitterListener;
  once: boolean;
  filter?: (event: IEventEmitterEventData) => boolean;
}
