// @robota-sdk/agent-core event-service
// Owns and exports event service interfaces and implementations
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
} from './interfaces';

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
} from './event-service';

export { TASK_EVENTS, TASK_EVENT_PREFIX } from './task-events';
export { USER_EVENTS, USER_EVENT_PREFIX } from './user-events';
export type { TUserEvent } from './user-events';
