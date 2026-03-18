// @robota-sdk/event-service
// Re-exports types from @robota-sdk/agents (interfaces are owned by agents)
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
} from '@robota-sdk/agents';

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
