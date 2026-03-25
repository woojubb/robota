// @robota-sdk/agent-event-service
// Re-exports all event service types and implementations from @robota-sdk/agent-core.
// agent-core is the SSOT for all event types. This package is a thin re-export layer
// maintained for consumers that depend on @robota-sdk/agent-event-service directly.
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
  TEventExtensionValue,
  TEventUniversalValue,
  TEventLoggerData,
  IEventObjectValue,
} from '@robota-sdk/agent-core';

export {
  AbstractEventService,
  DEFAULT_ABSTRACT_EVENT_SERVICE,
  isDefaultEventService,
  bindEventServiceOwner,
  bindWithOwnerPath,
  DefaultEventService,
  StructuredEventService,
  ObservableEventService,
  composeEventName,
} from '@robota-sdk/agent-core';

export { TASK_EVENTS, TASK_EVENT_PREFIX } from '@robota-sdk/agent-core';
export { USER_EVENTS, USER_EVENT_PREFIX } from '@robota-sdk/agent-core';
export type { TUserEvent } from '@robota-sdk/agent-core';
